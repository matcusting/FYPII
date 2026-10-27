# Private media operations

The API stores student documents in `MEDIA_PRIVATE_DIR/verifications`, landlord identity and property-right documents in `MEDIA_PRIVATE_DIR/landlord-verifications`, and listing photos/review evidence in `MEDIA_PRIVATE_DIR/listings` (or `UPLOAD_DIR/listings` when no private root is configured). These directories are outside the public web root. Never commit them, include them in the Windows preview ZIP, or send a real document to a demo account.

## Integrity and orphan check

From `uts-housing-api`, with `.env` and the migrated PostgreSQL database available:

```bash
node --env-file-if-exists=.env --import tsx scripts/private-media-audit.mjs
```

The command compares upload rows and document/listing/review references with the files on disk. It exits nonzero if a referenced file is missing, its size is wrong, a listing metadata file disagrees, or a model points at a missing upload row. Its output contains random storage keys but no uploaded content or personal names. Files with no database reference are reported only after 30 days by default; choose a different grace period with `--orphan-days=60`. The check is read-only by default.

After checking a current backup and stopping uploads, `--quarantine` moves eligible old orphan files to `MEDIA_PRIVATE_DIR/quarantine/<timestamp>/`. It rechecks database references before moving each file, refuses to proceed if live media is inconsistent, and **never deletes** files. Restore a mistaken move by returning the file to its original category directory. The quarantine itself requires an approved retention period and separate manual deletion procedure; this tool does not decide when an identity document may legally be destroyed.

## Backup and restore procedure before real users

The database and private media must be backed up together during a maintenance window or with an infrastructure-level consistent snapshot. A PostgreSQL dump alone loses the document files; a media copy alone loses ownership and review records. Keep the backup outside Git and the public web directory, encrypt it, restrict operator access, and store the encryption key separately. Confirm that the backup includes the database plus all configured private-media and legacy upload directories. Practice a restore into an isolated database and private-media directory, then run the integrity command against that restored copy before accepting real student or landlord documents.

The project does not provision a backup provider, encryption-key storage, schedule, or retention period. Those depend on the host, budget, operator, and approved privacy policy. Do not label a local copy as a production backup until a scheduled backup and restore rehearsal have actually passed.
