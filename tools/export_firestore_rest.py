"""Export Firestore through its REST API using the current Firebase CLI login.

The output keeps Firestore's typed REST representation, including timestamps,
references, bytes, arrays, maps, nulls, document paths, and source timestamps.
No OAuth token is written to the export or printed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request


API_ROOT = "https://firestore.googleapis.com/v1"


def cli_token() -> str:
    config = Path.home() / ".config" / "configstore" / "firebase-tools.json"
    payload = json.loads(config.read_text(encoding="utf-8"))
    token = payload.get("tokens", {}).get("access_token")
    expires_at = int(payload.get("tokens", {}).get("expires_at", 0))
    now_ms = int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)
    if not token or expires_at <= now_ms:
        raise RuntimeError("Firebase CLI access token is missing or expired; run firebase login again.")
    return token


def request_json(token: str, url: str, body: dict | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    data = None
    method = "GET"
    if body is not None:
        method = "POST"
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(url, headers=headers, data=data, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Firestore API returned HTTP {exc.code}: {detail[:1000]}") from exc


def list_collection_ids(token: str, database_base: str, parent_path: str = "") -> list[str]:
    suffix = "documents" if not parent_path else "documents/" + urllib.parse.quote(parent_path, safe="/")
    url = f"{database_base}/{suffix}:listCollectionIds"
    ids: list[str] = []
    page_token = None
    while True:
        body = {"pageSize": 1000}
        if page_token:
            body["pageToken"] = page_token
        response = request_json(token, url, body)
        ids.extend(response.get("collectionIds", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            return sorted(set(ids))


def list_documents(token: str, database_base: str, parent_path: str, collection_id: str) -> list[dict]:
    document_path = "/".join(part for part in (parent_path, collection_id) if part)
    base_url = f"{database_base}/documents/{urllib.parse.quote(document_path, safe='/')}"
    documents: list[dict] = []
    page_token = None
    while True:
        query = {"pageSize": "1000", "showMissing": "true"}
        if page_token:
            query["pageToken"] = page_token
        response = request_json(token, base_url + "?" + urllib.parse.urlencode(query))
        documents.extend(response.get("documents", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            return documents


def relative_name(full_name: str) -> str:
    marker = "/documents/"
    if marker not in full_name:
        raise ValueError(f"Unexpected Firestore document name: {full_name}")
    return full_name.split(marker, 1)[1]


def export(project: str, output: Path, include_subcollections: bool = False) -> dict:
    token = cli_token()
    database_base = f"{API_ROOT}/projects/{project}/databases/(default)"
    top_level = list_collection_ids(token, database_base)
    rows: list[dict] = []

    def walk(parent_path: str, collection_id: str, top_collection: str) -> None:
        for document in list_documents(token, database_base, parent_path, collection_id):
            path = relative_name(document["name"])
            rows.append(
                {
                    "path": path,
                    "collectionPath": "/".join(path.split("/")[:-1]),
                    "documentId": path.split("/")[-1],
                    "topLevelCollection": top_collection,
                    "createTime": document.get("createTime"),
                    "updateTime": document.get("updateTime"),
                    "fields": document.get("fields", {}),
                }
            )
            if include_subcollections:
                for child_collection in list_collection_ids(token, database_base, path):
                    walk(path, child_collection, top_collection)

    for collection_id in top_level:
        walk("", collection_id, collection_id)

    rows.sort(key=lambda row: row["path"])
    counts = {collection: 0 for collection in top_level}
    for row in rows:
        counts[row["topLevelCollection"]] += 1

    exported_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    result = {
        "format": "firestore-rest-typed-v1",
        "sourceProject": project,
        "database": "(default)",
        "scope": "recursive" if include_subcollections else "top-level collections used by the web application",
        "exportedAtUtc": exported_at,
        "topLevelCollections": top_level,
        "documentCounts": counts,
        "documentCount": len(rows),
        "documents": rows,
    }
    encoded = json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(encoded)
    digest = hashlib.sha256(encoded).hexdigest()
    return {"output": str(output), "sha256": digest, "documentCount": len(rows), "counts": counts}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--include-subcollections", action="store_true")
    args = parser.parse_args()
    summary = export(args.project, args.output.resolve(), args.include_subcollections)
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
