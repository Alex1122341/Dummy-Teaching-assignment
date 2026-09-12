# Firebase to Azure SQL mirror tools

These scripts create a typed JSON export of the Firestore collections used by the site and load it into `dbo.FirestoreDocument`. The JSON retains document paths, IDs, Firestore REST field types, timestamps, and a collection count manifest.

The export contains private faculty and account data. Keep it outside the repository; this project ignores `firebase-export-private/` and `*.private.json`.

```powershell
python tools/export_firestore_rest.py `
  --project tester-teaching `
  --output ..\firebase-export-private\tester-teaching-firestore.json

powershell -ExecutionPolicy Bypass -File tools/import_firestore_azure_sql.ps1 `
  -ExportPath ..\firebase-export-private\tester-teaching-firestore.json `
  -Server ucvm-teaching-lab-xz-20260911.database.windows.net `
  -Database teaching-assignment-lab
```

The importer uses Microsoft Entra device authentication, opens a SQL transaction, bulk-copies the mirror, compares total and per-collection counts, records the export SHA-256 in `dbo.FirestoreImportRun`, and commits only after validation succeeds.

This raw mirror does not switch the live website to Azure. A production Azure version still needs a server-side API, Entra application registration, managed identity, and UofC network approval before the browser can safely read or write Azure SQL.

The current static site can also be published to the Azure Static Web App practice resource at `https://red-cliff-04871ca0f.5.azurestaticapps.net`. This only changes the web host; the copied site continues using Firebase Authentication and Firestore until an Azure API is implemented. The Azure hostname must remain listed under Firebase Authentication authorized domains for phone authentication and reCAPTCHA.

```powershell
powershell -ExecutionPolicy Bypass -File tools/deploy_azure_static_web.ps1
```
