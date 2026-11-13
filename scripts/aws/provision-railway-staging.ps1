param(
     [string]$ProfileName = "reeplay-staging",
     [string]$Region = "us-east-1",
     [string]$AccountId = "637423435427"
)

$ErrorActionPreference = "Stop"

Import-Module AWS.Tools.S3, AWS.Tools.IdentityManagement

$bucketName = "reeplay-railway-staging-$AccountId"
$userName = "reeplay-railway-staging"
$mediaConvertRoleName = "reeplay-railway-staging-mediaconvert"
$mediaConvertRoleArn = "arn:aws:iam::$AccountId`:role/$mediaConvertRoleName"

try {
     Get-S3BucketLocation -BucketName $bucketName -ProfileName $ProfileName -Region $Region | Out-Null
} catch {
     New-S3Bucket -BucketName $bucketName -ProfileName $ProfileName -Region $Region | Out-Null
}

Add-S3PublicAccessBlock `
     -BucketName $bucketName `
     -PublicAccessBlockConfiguration_BlockPublicAcl $true `
     -PublicAccessBlockConfiguration_IgnorePublicAcl $true `
     -PublicAccessBlockConfiguration_BlockPublicPolicy $true `
     -PublicAccessBlockConfiguration_RestrictPublicBucket $true `
     -ProfileName $ProfileName `
     -Region $Region | Out-Null

$encryptionDefault = [Amazon.S3.Model.ServerSideEncryptionByDefault]::new()
$encryptionDefault.ServerSideEncryptionAlgorithm = "AES256"
$encryptionRule = [Amazon.S3.Model.ServerSideEncryptionRule]::new()
$encryptionRule.ServerSideEncryptionByDefault = $encryptionDefault
Set-S3BucketEncryption `
     -BucketName $bucketName `
     -ServerSideEncryptionConfiguration_ServerSideEncryptionRule $encryptionRule `
     -ProfileName $ProfileName `
     -Region $Region | Out-Null

$expiration = [Amazon.S3.Model.LifecycleRuleExpiration]::new()
$expiration.Days = 7
$abortMultipart = [Amazon.S3.Model.LifecycleRuleAbortIncompleteMultipartUpload]::new()
$abortMultipart.DaysAfterInitiation = 1
$lifecycleRule = [Amazon.S3.Model.LifecycleRule]::new()
$lifecycleRule.Id = "expire-staging-media"
$lifecycleRule.Prefix = ""
$lifecycleRule.Status = "Enabled"
$lifecycleRule.Expiration = $expiration
$lifecycleRule.AbortIncompleteMultipartUpload = $abortMultipart
Write-S3LifecycleConfiguration `
     -BucketName $bucketName `
     -Configuration_Rule $lifecycleRule `
     -ProfileName $ProfileName `
     -Region $Region | Out-Null

try {
     Get-IAMRole -RoleName $mediaConvertRoleName -ProfileName $ProfileName -Region $Region | Out-Null
} catch {
     $trustPolicy = @{
          Version = "2012-10-17"
          Statement = @(@{
               Effect = "Allow"
               Principal = @{ Service = "mediaconvert.amazonaws.com" }
               Action = "sts:AssumeRole"
          })
     } | ConvertTo-Json -Depth 8 -Compress
     New-IAMRole `
          -RoleName $mediaConvertRoleName `
          -AssumeRolePolicyDocument $trustPolicy `
          -Description "MediaConvert access to Reeplay Railway staging media" `
          -ProfileName $ProfileName `
          -Region $Region | Out-Null
}

$mediaConvertPolicy = @{
     Version = "2012-10-17"
     Statement = @(
          @{
               Effect = "Allow"
               Action = @("s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts")
               Resource = "arn:aws:s3:::$bucketName/*"
          },
          @{
               Effect = "Allow"
               Action = @("s3:GetBucketLocation", "s3:ListBucket")
               Resource = "arn:aws:s3:::$bucketName"
          }
     )
} | ConvertTo-Json -Depth 8 -Compress
Write-IAMRolePolicy `
     -RoleName $mediaConvertRoleName `
     -PolicyName "reeplay-railway-staging-media" `
     -PolicyDocument $mediaConvertPolicy `
     -ProfileName $ProfileName `
     -Region $Region | Out-Null

try {
     Get-IAMUser -UserName $userName -ProfileName $ProfileName -Region $Region | Out-Null
} catch {
     New-IAMUser -UserName $userName -ProfileName $ProfileName -Region $Region | Out-Null
}

$applicationPolicy = @{
     Version = "2012-10-17"
     Statement = @(
          @{
               Effect = "Allow"
               Action = @("s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads")
               Resource = "arn:aws:s3:::$bucketName"
          },
          @{
               Effect = "Allow"
               Action = @("s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts")
               Resource = "arn:aws:s3:::$bucketName/*"
          },
          @{
               Effect = "Allow"
               Action = @("mediaconvert:DescribeEndpoints", "mediaconvert:CreateJob", "mediaconvert:GetJob", "mediaconvert:CancelJob")
               Resource = "*"
          },
          @{
               Effect = "Allow"
               Action = "iam:PassRole"
               Resource = $mediaConvertRoleArn
               Condition = @{ StringEquals = @{ "iam:PassedToService" = "mediaconvert.amazonaws.com" } }
          }
     )
} | ConvertTo-Json -Depth 10 -Compress
Write-IAMUserPolicy `
     -UserName $userName `
     -PolicyName "reeplay-railway-staging-application" `
     -PolicyDocument $applicationPolicy `
     -ProfileName $ProfileName `
     -Region $Region | Out-Null

$existingKeys = @(Get-IAMAccessKey -UserName $userName -ProfileName $ProfileName -Region $Region)
if ($existingKeys.Count -gt 0) {
     throw "The staging IAM user already has an access key. Refusing to create an additional key."
}

$accessKey = New-IAMAccessKey -UserName $userName -ProfileName $ProfileName -Region $Region

[pscustomobject]@{
     BucketName = $bucketName
     Region = $Region
     MediaConvertRoleArn = $mediaConvertRoleArn
     AccessKeyId = $accessKey.AccessKeyId
     SecretAccessKey = $accessKey.SecretAccessKey
}
