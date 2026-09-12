param(
    [Parameter(Mandatory = $true)][string]$ExportPath,
    [string]$Server = 'ucvm-teaching-lab-xz-20260911.database.windows.net',
    [string]$Database = 'teaching-assignment-lab',
    [string]$TenantId = 'c609a0ec-a5e3-4631-9686-192280bd9151'
)

$ErrorActionPreference = 'Stop'

function Get-SqlAccessToken {
    # Microsoft Azure CLI public-client application. Device flow does not use a client secret.
    $clientId = '04b07795-8ddb-461a-bbee-02f9e1bf7b46'
    $deviceEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode"
    $tokenEndpoint = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
    $scope = 'https://database.windows.net/.default openid profile offline_access'
    $device = Invoke-RestMethod -Method Post -Uri $deviceEndpoint -ContentType 'application/x-www-form-urlencoded' -Body @{
        client_id = $clientId
        scope = $scope
    }

    $devicePrompt = [pscustomobject]@{
        verificationUri = $device.verification_uri
        userCode = $device.user_code
        expiresInSeconds = $device.expires_in
    } | ConvertTo-Json -Compress
    Write-Host $devicePrompt

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds([int]$device.expires_in)
    $interval = [Math]::Max(5, [int]$device.interval)
    while ([DateTimeOffset]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds $interval
        try {
            $token = Invoke-RestMethod -Method Post -Uri $tokenEndpoint -ContentType 'application/x-www-form-urlencoded' -Body @{
                grant_type = 'urn:ietf:params:oauth:grant-type:device_code'
                client_id = $clientId
                device_code = $device.device_code
            }
            return $token.access_token
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

$resolvedExport = (Resolve-Path -LiteralPath $ExportPath).Path
$fileBytes = [System.IO.File]::ReadAllBytes($resolvedExport)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try { $exportHash = [Convert]::ToHexString($sha256.ComputeHash($fileBytes)).ToLowerInvariant() }
finally { $sha256.Dispose() }

$export = [System.Text.Encoding]::UTF8.GetString($fileBytes) | ConvertFrom-Json -AsHashtable
if ($export.format -ne 'firestore-rest-typed-v1') { throw "Unsupported export format: $($export.format)" }
if ($export.sourceProject -ne 'tester-teaching') { throw "Unexpected source project: $($export.sourceProject)" }
if ([int]$export.documentCount -ne @($export.documents).Count) { throw 'Export documentCount does not match the documents array.' }

$data = [System.Data.DataTable]::new('FirestoreImport')
[void]$data.Columns.Add('DocumentPath', [string])
[void]$data.Columns.Add('DocumentPathHash', [byte[]])
[void]$data.Columns.Add('CollectionPath', [string])
[void]$data.Columns.Add('DocumentId', [string])
[void]$data.Columns.Add('Payload', [string])
[void]$data.Columns.Add('SourceProject', [string])
[void]$data.Columns.Add('SourceCreateTime', [DateTimeOffset])
[void]$data.Columns.Add('SourceUpdateTime', [DateTimeOffset])
[void]$data.Columns.Add('ImportedAtUtc', [DateTime])

$pathHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $importedAt = [DateTime]::UtcNow
    foreach ($document in $export.documents) {
        $row = $data.NewRow()
        $row.DocumentPath = [string]$document.path
        $row.DocumentPathHash = $pathHasher.ComputeHash([System.Text.Encoding]::Unicode.GetBytes([string]$document.path))
        $row.CollectionPath = [string]$document.collectionPath
        $row.DocumentId = [string]$document.documentId
        $row.Payload = $document.fields | ConvertTo-Json -Depth 100 -Compress
        $row.SourceProject = [string]$export.sourceProject
        $row.SourceCreateTime = if ($document.createTime) { [DateTimeOffset]::Parse([string]$document.createTime) } else { [DBNull]::Value }
        $row.SourceUpdateTime = if ($document.updateTime) { [DateTimeOffset]::Parse([string]$document.updateTime) } else { [DBNull]::Value }
        $row.ImportedAtUtc = $importedAt
        [void]$data.Rows.Add($row)
    }
}
finally { $pathHasher.Dispose() }

$accessToken = Get-SqlAccessToken
$connectionString = "Server=tcp:$Server,1433;Initial Catalog=$Database;Encrypt=True;TrustServerCertificate=False;Connection Timeout=120;"
$connection = [System.Data.SqlClient.SqlConnection]::new($connectionString)
$connection.AccessToken = $accessToken
$connection.Open()
$transaction = $connection.BeginTransaction()
try {
    $setup = $connection.CreateCommand()
    $setup.Transaction = $transaction
    $setup.CommandTimeout = 120
    $setup.CommandText = @'
IF OBJECT_ID(N'dbo.FirestoreImportRun', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FirestoreImportRun (
        ImportRunId bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_FirestoreImportRun PRIMARY KEY,
        SourceProject nvarchar(128) NOT NULL,
        SourceExportedAtUtc datetimeoffset(7) NOT NULL,
        ImportedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_FirestoreImportRun_ImportedAtUtc DEFAULT SYSUTCDATETIME(),
        DocumentCount int NOT NULL,
        ExportSha256 char(64) NOT NULL,
        CollectionCountsJson nvarchar(max) NOT NULL,
        CONSTRAINT CK_FirestoreImportRun_CountsJson CHECK (ISJSON(CollectionCountsJson) = 1)
    );
END;
DELETE FROM dbo.FirestoreDocument;
'@
    [void]$setup.ExecuteNonQuery()

    $bulk = [System.Data.SqlClient.SqlBulkCopy]::new($connection, [System.Data.SqlClient.SqlBulkCopyOptions]::CheckConstraints, $transaction)
    try {
        $bulk.DestinationTableName = 'dbo.FirestoreDocument'
        $bulk.BatchSize = 500
        $bulk.BulkCopyTimeout = 300
        foreach ($column in $data.Columns) { [void]$bulk.ColumnMappings.Add($column.ColumnName, $column.ColumnName) }
        $bulk.WriteToServer($data)
    }
    finally { $bulk.Dispose() }

    $record = $connection.CreateCommand()
    $record.Transaction = $transaction
    $record.CommandText = @'
INSERT dbo.FirestoreImportRun
    (SourceProject, SourceExportedAtUtc, DocumentCount, ExportSha256, CollectionCountsJson)
VALUES
    (@SourceProject, @SourceExportedAtUtc, @DocumentCount, @ExportSha256, @CollectionCountsJson);
'@
    [void]$record.Parameters.AddWithValue('@SourceProject', [string]$export.sourceProject)
    [void]$record.Parameters.AddWithValue('@SourceExportedAtUtc', [DateTimeOffset]::Parse([string]$export.exportedAtUtc))
    [void]$record.Parameters.AddWithValue('@DocumentCount', [int]$export.documentCount)
    [void]$record.Parameters.AddWithValue('@ExportSha256', $exportHash)
    [void]$record.Parameters.AddWithValue('@CollectionCountsJson', ($export.documentCounts | ConvertTo-Json -Compress))
    [void]$record.ExecuteNonQuery()

    $verify = $connection.CreateCommand()
    $verify.Transaction = $transaction
    $verify.CommandText = 'SELECT CollectionPath, COUNT_BIG(*) AS DocumentCount FROM dbo.FirestoreDocument GROUP BY CollectionPath ORDER BY CollectionPath;'
    $reader = $verify.ExecuteReader()
    $actual = [ordered]@{}
    while ($reader.Read()) { $actual[[string]$reader.GetString(0)] = [long]$reader.GetInt64(1) }
    $reader.Close()

    foreach ($property in $export.documentCounts.GetEnumerator()) {
        if (-not $actual.Contains($property.Key) -or [long]$actual[$property.Key] -ne [long]$property.Value) {
            throw "Azure count mismatch for $($property.Key): expected $($property.Value), actual $($actual[$property.Key])"
        }
    }
    if (($actual.Values | Measure-Object -Sum).Sum -ne [int]$export.documentCount) { throw 'Azure total document count mismatch.' }

    $transaction.Commit()
    [pscustomobject]@{
        server = $Server
        database = $Database
        sourceProject = $export.sourceProject
        exportSha256 = $exportHash
        documentCount = [int]$export.documentCount
        collectionCounts = $actual
    } | ConvertTo-Json -Depth 5 -Compress | Write-Output
}
catch {
    try { $transaction.Rollback() } catch {}
    throw
}
finally {
    $connection.Dispose()
    $accessToken = $null
}
