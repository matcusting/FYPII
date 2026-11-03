# Verification evidence retention (local operator procedure)

This command retires the **private document bytes** and their `MediaUpload` rows while preserving the verification decision and a non-sensitive audit entry. It covers student ID/offer-letter evidence, landlord identity/company evidence, and proof of the right to rent a particular property. It does not erase account data, case decisions, lawyer recommendations, listing photos, review evidence, or encrypted backup copies.

## Approved periods and outstanding legal notice

The project owner specified these document periods: approved student evidence is retained through **one calendar year after the offer letter's study end date**; landlord identity and property-authorization evidence is retained for **two calendar years** after its applicable anchor. The administrator must manually read the offer letter and enter its exact `studyEndsAt` date when approving a new student. The server stores the derived `evidenceRetainUntil`; it does not infer a date by OCR or filename. An approved legacy student case without that reviewed date is skipped by this tool until an authorized administrator checks the still-stored offer letter and corrects/backfills the date. A rejected student application's uploaded files are removed immediately under the existing rejection flow.

For landlord and property applications, an approval's two-year clock starts **only after approval expiry**; rejection starts at the rejection or automatic invalidation decision; revocation starts at revocation. Pending requests and still-valid approvals are never eligible. Account-deletion approvals still erase the account's private files immediately. Calendar-year arithmetic clamps 29 February to 28 February where necessary. The final Privacy Notice must still name the operating entity, explain legal basis, preservation holds and backup expiry, and be approved with counsel before processing real documents. **No deletion schedule is enabled automatically.** Never run retention while a category has an unresolved dispute or legal hold; the CLI has no per-case hold field, so use a maintenance review before each apply run. Retiring a student's approved proof does not change their verified status, and the administrator can no longer reopen the original files.

## Dry-run and apply

Stop the API, email worker and frontend before **apply**. First create and verify a current encrypted database-and-media backup outside the project folder. Keep PostgreSQL running. From `uts-housing-api` in PowerShell:

```powershell
npm run evidence:retention -- --student-offer-end --identity-years=2 --property-years=2
```

The default is read-only. It reports counts only, not names, addresses, document content, filenames or storage keys. A category whose flag is omitted is untouched. Add `--limit=100` to bound a run; the default batch limit is 100 cases and the maximum is 1000. The command checks the **selected batch** before any mutation and fails if one of its files is missing, is a symlink, has the wrong size, or has metadata that does not match the case owner and purpose. Eligible cases outside that batch are checked in later runs. Investigate with [private media operations](PRIVATE_MEDIA_OPERATIONS.md) before continuing.

After reading the dry-run and approving the maintenance window, execute:

```powershell
npm run evidence:retention -- --student-offer-end --identity-years=2 --property-years=2 --limit=100 --apply --confirm-maintenance --confirm=DELETE_ELIGIBLE_EVIDENCE --actor-email=<active-admin-email>
```

The command checks that the actor is an active administrator. It rechecks each case in a database transaction, moves matching files into a private quarantine, clears only that case's evidence keys and media metadata, writes an audit entry, then deletes the quarantined bytes. It does not change approval status. A failed transaction restores moved files. If final filesystem deletion fails, it leaves private quarantined bytes and exits with an error; inspect them before retrying. Re-run the dry-run to see any remaining eligible cases. Never place evidence directories under a public web root.

The Windows wrapper uses the current project directory and refuses an apply run while the default local API port 3001 is listening:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Run-EvidenceRetention.ps1 -StudentOfferEnd -IdentityYears 2 -PropertyYears 2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Run-EvidenceRetention.ps1 -StudentOfferEnd -IdentityYears 2 -PropertyYears 2 -Apply -ConfirmMaintenance -ActorEmail <active-admin-email>
```

Run the wrapper from the project root. For a Windows Task Scheduler job, use `powershell.exe` as the program and `-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\FYPII\scripts\Run-EvidenceRetention.ps1" -StudentOfferEnd -IdentityYears 2 -PropertyYears 2 -Apply -ConfirmMaintenance -ActorEmail <active-admin-email>` as arguments **only after** the final legal notice, backup and maintenance process have been approved and rehearsed. Arrange for the API to be stopped at the run time; the wrapper aborts if it detects the default local listener. Inspect Task Scheduler history and exit status. A local scheduled task is not installed automatically.

## Crash recovery

If the process or computer stops after a file move but before its database transaction commits, the DB may still point to a file under `MEDIA_PRIVATE_DIR/retention-quarantine`. Do **not** rerun apply. First run from `uts-housing-api`:

```powershell
npm run evidence:recover
npm run evidence:recover -- --apply --confirm-maintenance
```

The first command is a read-only count. The second restores **only** quarantined files still referenced by an evidence record and its media row. Quarantined files whose DB pointers were already cleared are left untouched, so recovery never resurrects deleted evidence. Run the private-media audit afterward. Do not manually delete leftover quarantine contents without checking the final retention policy and encrypted backup; backup copies continue to exist until their own approved retention period expires.
