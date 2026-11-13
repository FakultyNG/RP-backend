param(
     [string]$ProfileName = "reeplay-staging",
     [string]$Region = "us-east-1",
     [string]$AccountId = "637423435427",
     [string]$BucketName = "reeplay-railway-staging-637423435427"
)

$ErrorActionPreference = "Stop"

Import-Module AWS.Tools.CloudFront, AWS.Tools.S3

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$rsa = [Security.Cryptography.RSA]::Create(2048)
$privateKey = $rsa.ExportRSAPrivateKeyPem()
$publicKey = $rsa.ExportSubjectPublicKeyInfoPem()

$publicKeyResponse = New-CFPublicKey `
     -PublicKeyConfig_Name "reeplay-railway-staging-$suffix" `
     -PublicKeyConfig_CallerReference ([guid]::NewGuid().ToString()) `
     -PublicKeyConfig_Comment "Railway staging signed media URLs" `
     -PublicKeyConfig_EncodedKey $publicKey `
     -ProfileName $ProfileName `
     -Region $Region `
     -Select "*"
$publicKeyId = $publicKeyResponse.PublicKey.Id

$keyGroupResponse = New-CFKeyGroup `
     -KeyGroupConfig_Name "reeplay-railway-staging-$suffix" `
     -KeyGroupConfig_Comment "Railway staging signed media URLs" `
     -KeyGroupConfig_Item $publicKeyId `
     -ProfileName $ProfileName `
     -Region $Region `
     -Select "*"
$keyGroupId = $keyGroupResponse.KeyGroup.Id

$oacResponse = New-CFOriginAccessControl `
     -OriginAccessControlConfig_Name "reeplay-railway-staging-$suffix" `
     -OriginAccessControlConfig_Description "Private access to Railway staging media" `
     -OriginAccessControlConfig_OriginAccessControlOriginType "s3" `
     -OriginAccessControlConfig_SigningBehavior "always" `
     -OriginAccessControlConfig_SigningProtocol "sigv4" `
     -ProfileName $ProfileName `
     -Region $Region `
     -Select "*"
$oacId = $oacResponse.OriginAccessControl.Id

$origin = [Amazon.CloudFront.Model.Origin]::new()
$origin.Id = "reeplay-staging-s3"
$origin.DomainName = "$BucketName.s3.$Region.amazonaws.com"
$origin.OriginAccessControlId = $oacId
$origin.S3OriginConfig = [Amazon.CloudFront.Model.S3OriginConfig]::new()
$origin.S3OriginConfig.OriginAccessIdentity = ""

$distributionResponse = New-CFDistribution `
     -DistributionConfig_CallerReference ([guid]::NewGuid().ToString()) `
     -DistributionConfig_Comment "Reeplay Railway staging media" `
     -DistributionConfig_Enabled $true `
     -DistributionConfig_HttpVersion "http2and3" `
     -DistributionConfig_IsIPV6Enabled $true `
     -DistributionConfig_PriceClass "PriceClass_100" `
     -Origins_Item $origin `
     -Origins_Quantity 1 `
     -DefaultCacheBehavior_TargetOriginId $origin.Id `
     -DefaultCacheBehavior_ViewerProtocolPolicy "redirect-to-https" `
     -DefaultCacheBehavior_CachePolicyId "658327ea-f89d-4fab-a63d-7e88639e58f6" `
     -DefaultCacheBehavior_Compress $true `
     -AllowedMethods_Item @("GET", "HEAD", "OPTIONS") `
     -AllowedMethods_Quantity 3 `
     -CachedMethods_Item @("GET", "HEAD") `
     -CachedMethods_Quantity 2 `
     -TrustedKeyGroups_Enabled $true `
     -TrustedKeyGroups_Item $keyGroupId `
     -TrustedKeyGroups_Quantity 1 `
     -ViewerCertificate_CloudFrontDefaultCertificate $true `
     -ProfileName $ProfileName `
     -Region $Region `
     -Select "*"
$distribution = $distributionResponse.Distribution

$bucketPolicy = @{
     Version = "2012-10-17"
     Statement = @(@{
          Sid = "AllowCloudFrontServicePrincipalReadOnly"
          Effect = "Allow"
          Principal = @{ Service = "cloudfront.amazonaws.com" }
          Action = "s3:GetObject"
          Resource = "arn:aws:s3:::$BucketName/*"
          Condition = @{ StringEquals = @{ "AWS:SourceArn" = $distribution.ARN } }
     })
} | ConvertTo-Json -Depth 10 -Compress
Write-S3BucketPolicy `
     -BucketName $BucketName `
     -Policy $bucketPolicy `
     -ProfileName $ProfileName `
     -Region $Region | Out-Null

$rsa.Dispose()

[pscustomobject]@{
     DistributionId = $distribution.Id
     DistributionDomain = "https://$($distribution.DomainName)"
     PublicKeyId = $publicKeyId
     KeyGroupId = $keyGroupId
     OriginAccessControlId = $oacId
     PrivateKey = $privateKey
}
