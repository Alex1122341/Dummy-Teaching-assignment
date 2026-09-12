param(
    [string]$SitePath = (Split-Path -Parent $PSScriptRoot),
    [string]$SubscriptionId = 'd81fa2f8-5115-49c9-80c5-51accac46bed',
    [string]$ResourceGroup = 'rg-ucvm-teaching-lab',
    [string]$AppName = 'ucvm-teaching-lab-web',
    [string]$TenantId = 'c609a0ec-a5e3-4631-9686-192280bd9151'
)

$ErrorActionPreference = 'Stop'

function Get-ArmAccessToken {
    $clientId = '04b07795-8ddb-461a-bbee-02f9e1bf7b46'
    $deviceEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode"
    $tokenEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $device = Invoke-RestMethod -Method Post -Uri $deviceEndpoint -ContentType 'application/x-www-form-urlencoded' -Body @{
        client_id = $clientId
        scope = 'https://management.azure.com/.default openid profile offline_access'
    }
    [pscustomobject]@{
        verificationUri = $device.verification_uri
        userCode = $device.user_code
        expiresInSeconds = $device.expires_in
    } | ConvertTo-Json -Compress | Write-Host

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds([int]$device.expires_in)
    $interval = [Math]::Max(5, [int]$device.interval)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds $interval
        try {
            return (Invoke-RestMethod -Method Post -Uri $tokenEndpoint -ContentType 'application/x-www-form-urlencoded' -Body @{
                grant_type = 'urn:ietf:params:oauth:grant-type:device_code'
                client_id = $clientId
                device_code = $device.device_code
            }).access_token
        }
        catch {
            $detail = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($detail.error -eq 'authorization_pending') { continue }
            if ($detail.error -eq 'slow_down') { $interval += 5; continue }
            throw
        }
    }
    throw 'Microsoft Entra device authorization expired.'
}

$armToken = Get-ArmAccessToken
$secretUri = "https://management.azure.com/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.Web/staticSites/$AppName/listSecrets?api-version=2023-12-01"
$deploymentToken = (Invoke-RestMethod -Method Post -Uri $secretUri -Headers @{ Authorization = "Bearer $armToken" }).properties.apiKey
if ([string]::IsNullOrWhiteSpace($deploymentToken)) { throw 'Azure did not return a Static Web Apps deployment token.' }

$deployClient = Get-ChildItem -LiteralPath (Join-Path $env:USERPROFILE '.swa\deploy') -Filter 'StaticSitesClient.exe' -Recurse -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if ([string]::IsNullOrWhiteSpace($deployClient)) {
    throw 'Azure Static Web Apps deployment client is not installed. Run SWA CLI once to download it.'
}

$stagingPath = Join-Path ([System.IO.Path]::GetTempPath()) 'ucvm-teaching-azure-static'
$webFiles = @(
    'approval-workflow.js',
    'faculty-access.css',
    'faculty-access.js',
    'faculty-admin-enhancements.js',
    'faculty-admin.html',
    'faculty-dashboard.html',
    'faculty-dashboard.js',
    'index.html',
    'password.html',
    'password.js',
    'user-management.html',
    'user-management.js'
)
if (Test-Path -LiteralPath $stagingPath) {
    Remove-Item -LiteralPath $stagingPath -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingPath | Out-Null
foreach ($file in $webFiles) {
    $source = Join-Path $SitePath $file
    if (-not (Test-Path -LiteralPath $source)) { throw "Required web file is missing: $source" }
    Copy-Item -LiteralPath $source -Destination $stagingPath
}

$deployVariables = @{
    DEPLOYMENT_ACTION = 'upload'
    DEPLOYMENT_PROVIDER = 'SwaCli'
    REPOSITORY_BASE = $stagingPath
    SKIP_APP_BUILD = 'true'
    SKIP_API_BUILD = 'true'
    DEPLOYMENT_TOKEN = $deploymentToken
    APP_LOCATION = $stagingPath
    VERBOSE = 'true'
    SWA_CLI_VERSION = '1.1.10'
    SWA_CLI_DEBUG = 'silly'
}
$previousVariables = @{}
try {
    foreach ($name in $deployVariables.Keys) {
        $previousVariables[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $deployVariables[$name], 'Process')
    }
    & $deployClient
    if ($LASTEXITCODE -ne 0) { throw "Static Web Apps deployment client exited with code $LASTEXITCODE." }
}
finally {
    foreach ($name in $deployVariables.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousVariables[$name], 'Process')
    }
    $deploymentToken = $null
    $armToken = $null
    if (Test-Path -LiteralPath $stagingPath) {
        Remove-Item -LiteralPath $stagingPath -Recurse -Force
    }
}
