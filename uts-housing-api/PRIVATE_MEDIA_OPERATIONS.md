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

The database and private media must be backed up together during a maintenance window or with an infrastructure-level consistent snapshot. A PostgreSQL dump alone loses the document files; a media copy alone loses ownership and review records. Keep the backup outside Git and the public web directory, encrypt it, restrict operator access, and store the encryption key separately. The Windows [backup command](../WINDOWS_LOCAL_SETUP.md) now packages a local PostgreSQL dump, `.env`, private media and legacy uploads into one AES-256-GCM file. Its `verify` command checks authentication and every file hash; `rehearse` restores the dump into a new disposable database and runs this media audit against the extracted files, then removes that disposable database. Run it only after stopping the API and email worker while leaving PostgreSQL available. Verification briefly extracts plaintext into the operating system's temporary directory before removing it, so use a protected local disk. The command deliberately never overwrites the live database. Keep the passphrase in a separate protected place; a lost passphrase cannot be recovered.

The Windows [scheduled backup installer](../WINDOWS_LOCAL_SETUP.md) can write daily encrypted backups to an external drive or protected network share, optionally mirror them, verify each archive, rehearse a restore weekly, and apply an explicitly configured retention period. The operator must install the task on the actual Windows computer and provide an accessible off-device destination, remember the passphrase separately, check the first run and approve a retention period. No remote provider, key escrow, or legal retention period can be provisioned by this repository. Do not label a local copy as a production backup until a scheduled off-device backup and restore rehearsal have actually passed.
