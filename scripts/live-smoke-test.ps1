param(
  [string]$BaseUrl = 'https://reeplay-api-ts-production.up.railway.app/api/v1',
  [string]$MediaUrl = 'https://reeplay-media-production.up.railway.app',
  [string]$RtmpUrl = 'rtmp://nozomi.proxy.rlwy.net:49887/live',
  [string]$AdminEmail = 'superadmin@reeplay.app',
  [Parameter(Mandatory = $true)][string]$AdminPassword,
  [string]$ClientId = '6af72c0e1a036ea1c67fa918',
  [string]$CoverPhoto = 'C:\Users\User\Downloads\download.webp'
)

$ErrorActionPreference = 'Stop'
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/superadmin/auth/login" `
  -ContentType 'application/json' `
  -Body (@{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json)
$headers = @{ 'superadmin-auth' = $login.data.token }
$testId = $null

try {
  $title = "Railway live smoke test $(Get-Date -Format 'yyyyMMdd-HHmmss')"
  $liveData = @{
    clientId = $ClientId
    title = $title
    subTitle = 'Automated end-to-end validation'
    pg = 'PG'
    start = (Get-Date).ToUniversalTime().AddMinutes(-1).ToString('o')
    expiry = (Get-Date).ToUniversalTime().AddMinutes(15).ToString('o')
    description = 'Temporary live test; deleted automatically'
    vidClass = 'free'
    type = 'event'
    upcoming = $false
    location = 'Railway'
  } | ConvertTo-Json -Compress

  $created = Invoke-RestMethod -Method Post -Uri "$BaseUrl/superadmin/shared/lives/create" `
    -Headers $headers -Form @{ data = $liveData; coverPhoto = Get-Item -LiteralPath $CoverPhoto } `
    -TimeoutSec 90
  $testId = $created.data.liveId

  $list = Invoke-RestMethod -Uri "$BaseUrl/superadmin/lives/all/event?limit=20&page=1" `
    -Headers $headers -TimeoutSec 30
  $event = @($list.data) | Where-Object { $_._id -eq $testId } | Select-Object -First 1
  if (-not $event -or -not $event.streamKey) {
    throw 'Created event or stream key was not returned'
  }

  $ffmpeg = (Resolve-Path -LiteralPath '.\node_modules\@ffmpeg-installer\win32-x64\ffmpeg.exe').Path
  $publisher = Start-Process -FilePath $ffmpeg -WindowStyle Hidden -PassThru -ArgumentList @(
    '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi',
    '-i', 'testsrc=size=320x180:rate=10', '-t', '12', '-c:v', 'libx264', '-g', '20',
    '-preset', 'ultrafast', '-tune', 'zerolatency', '-f', 'flv',
    "$RtmpUrl/$($event.streamKey)"
  )

  $manifestUrl = "$MediaUrl/hls/$($event.streamKey)/index.m3u8"
  $manifestAvailable = $false
  for ($attempt = 0; $attempt -lt 10 -and -not $manifestAvailable; $attempt++) {
    Start-Sleep -Seconds 2
    try {
      $manifest = Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl -TimeoutSec 10
      $manifestAvailable = $manifest.StatusCode -eq 200
    } catch {
      # HLS needs a few segments before the first playlist is available.
    }
  }

  $publisher.WaitForExit(25000) | Out-Null
  Start-Sleep -Seconds 3
  $afterList = Invoke-RestMethod -Uri "$BaseUrl/superadmin/lives/all/event?limit=20&page=1" `
    -Headers $headers -TimeoutSec 30
  $after = @($afterList.data) | Where-Object { $_._id -eq $testId } | Select-Object -First 1

  [pscustomobject]@{
    created = [bool]$testId
    publisherExit = $publisher.ExitCode
    hlsManifest = $manifestAvailable
    activeAfterPublish = $after.active
    endedAtRecorded = [bool]$after.endedAt
  } | ConvertTo-Json
} finally {
  if ($testId) {
    Invoke-RestMethod -Method Delete -Uri "$BaseUrl/superadmin/shared/lives/delete/$testId" `
      -Headers $headers -TimeoutSec 45 | Out-Null
    'temporary_event_deleted=true'
  }
}
