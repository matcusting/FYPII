# Render deployment package (not deployed)

The repository contains a Render Blueprint in [`render.yaml`](../render.yaml). It
defines a paid PostgreSQL database, a Docker web service with a persistent
private-media disk, a private ClamAV scanner, and a background email worker.
`autoDeploy: false` prevents Git pushes from deploying subsequent changes. **Do
not create/import the Blueprint yet**: creating it is itself a deployment and
incurs provider charges. No Render service or external account is created by
committing these files.

## Why the website and API share one service

The browser uses secure, `SameSite=Lax` session cookies. The Render web image
serves the React build and forwards `/api/*` and `/health/*` to the API on
`127.0.0.1:3001`. This keeps login, document upload, and admin downloads on one
HTTPS origin. The web service exposes only the gateway port. The API listens on
loopback inside the container. `/health/ready` probes the database; uploads
also require the separate private scanner to be available.

The web image runs the checksum-checked database migrations before it starts
serving requests. The email worker runs the same locked migration command before
processing jobs. A migration failure prevents startup. Database changes are
therefore deliberately handled by a single transaction and advisory lock.

## Values to arrange before creating a Blueprint

The operator's public name and support email are compiled into the frontend as
`Marcus Ting Zhong Sheng` and `matcusting@gmail.com`, as supplied for the public
privacy/contact pages. Change the build values in `Dockerfile.render` if the
formal notice changes. Do not place credentials in `VITE_` variables.

The Blueprint prompts for these private settings in Render; enter them in
Render's environment UI, never in Git:

| Setting | Purpose |
| --- | --- |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | Real outbound email delivery for account verification, invitations, and password reset. Use a verified sender domain. Put identical settings on the web and worker. |
| `PUBLIC_BASE_URL` on the email worker | Exact HTTPS origin of the web service, such as the assigned `*.onrender.com` URL or a custom domain. Verification links must point there. |
| `GEOCODER_URL` on the web service | Dedicated HTTPS address-lookup endpoint that permits this use and can handle private property addresses. |
| `MFA_ENCRYPTION_KEY` on the web service | A stable, random 32-byte key encoded as exactly 64 hexadecimal characters. Generate it in a trusted local terminal with `openssl rand -hex 32`; never commit or rotate casually because it encrypts privileged authenticator secrets. |

The web startup script uses Render's `RENDER_EXTERNAL_URL` for
`FRONTEND_ORIGIN` and `PUBLIC_BASE_URL`. If a custom domain becomes canonical,
set **both** variables on the web service to that HTTPS origin and update the
worker's `PUBLIC_BASE_URL`; use a comma-separated `FRONTEND_ORIGIN` only if more
than one exact origin is intentionally accepted. Render generates a strong
`SESSION_SECRET` for the web service. Keep it stable across redeploys; changing
it signs every user out. `DATABASE_URL` comes from the managed database.

The ClamAV service must remain private. Confirm that the internal hostname in
Render's service dashboard matches `CLAMAV_HOST`; change the web environment
value if Render assigns a different hostname. It listens on port 3310. The API
rejects uploads when scanning is unavailable, and production refuses to start
with the development scanner bypass. Do not expose ClamAV to the public web.

There is no SMTP account yet. Production startup intentionally fails without
one, and the email worker cannot deliver account codes until it exists. Do not
replace it with the local outbox for a public site.

The API's `body-parser`, `multer`, and `nodemailer` packages have been updated
past the advisories found in the prior lockfile. Three high-severity advisories
remain in Prisma's CLI/config tooling, which is needed to build the client but
is removed from the Render runtime image with development and peer dependencies
after compilation. Re-run `npm audit` for both packages and review any new
advisories before a public launch; the remaining build-time tooling also needs
a compatible upstream fix. The API rejects compressed JSON bodies as an
additional guard.

## Data, backups, and maintenance

The web service's private disk stores actual student IDs, offer letters,
landlord identity and property-authorization files. A Render disk is tied to
one service and is **not** a substitute for an independent encrypted off-site
backup. The separate `compose.production.yml` and `maintenance.sh` are for a
self-managed Linux host; they require an off-device mount and cannot be used on
Render as written. `scripts/production-backup.mjs` also requires the API to be
stopped and a mounted destination. Do not claim Render media backups are
configured merely because the PostgreSQL plan includes database backups.

Before processing real documents on Render, arrange a private off-site backup
destination for **both** the database and private disk, store its credentials
outside Git, then implement and rehearse a Render-compatible encrypted export
and restore against a disposable database. Protect a separate copy of the
decryption key. A database-only backup cannot restore the uploaded files.
The retention worker is dry-run by default and remains manual until a tested
maintenance schedule and backup process are in place. See
[`RETENTION_OPERATIONS.md`](../uts-housing-api/RETENTION_OPERATIONS.md).
The API service itself retries durable private-file deletions every minute,
because the separate Render email worker has no access to the private disk.

The lawyer reviewer and administrator should be invited using the compiled
`account:invite:prod` workflow after the real SMTP connection and secure account
handoff are ready; see
[`ACCOUNT_INVITATIONS.md`](../uts-housing-api/ACCOUNT_INVITATIONS.md). Do not
seed public demo credentials into Render. The uploaded sample documents used in
development must remain outside the deployment image.

The project owner explicitly excluded the final launch acceptance exercise.
Before an eventual public release, run that exercise with fictional identities,
confirm verification delivery and scanner availability, validate the legal
notice with the engaged firm, perform a restore rehearsal, and check the site
from a separate browser/account. None of those external steps has been claimed
as completed here.
