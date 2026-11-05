# Private file deletion queue

When an administrator approves account deletion or rejects an unheld student verification, the same database transaction removes the file's live case reference and changes its `MediaUpload.status` to `DELETE_PENDING`. An unfilled upload ticket becomes `DELETE_PENDING_EMPTY`. The account deletion response may succeed before all bytes are removed; a filesystem error does not erase the retry record.

The API web process retries this queue every minute because it is the process with the private media disk mounted on Render. It first moves files into the private `deletion-quarantine` directory, records `DELETE_QUARANTINED`, removes the quarantined bytes, and finally removes the media row. If interrupted, the next run resumes from either location. `MEDIA_PRIVATE_DIR` must point to the persistent disk used by the API.

For a manual retry, from `uts-housing-api` run `npm run files:cleanup -- 100`. The result contains `selected`, `removed`, and `failed`; a nonzero `failed` exits with status 1. Repeat until `selected` is zero. A repeatedly failed row must be investigated before changing its status. Check the mounted media root, file permissions, live case references, and unexpected paths. Never remove a pending database row just to clear the queue: if the root is wrong, its private bytes may still exist elsewhere.

To inspect the queue without reading documents:

```sql
SELECT "purpose", "status", count(*) FROM "MediaUpload"
WHERE "status" IN ('DELETE_PENDING', 'DELETE_PENDING_EMPTY', 'DELETE_QUARANTINED')
GROUP BY "purpose", "status" ORDER BY "purpose", "status";
```

An active evidence preservation hold blocks account deletion. Rejected student evidence under a hold remains referenced and is handled through the separate evidence-retention workflow when the hold is released.
