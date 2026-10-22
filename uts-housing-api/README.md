# UTS Housing API (local development)

This Express API stores accounts, listings, roommate profiles, messages, reviews, and moderation records in PostgreSQL. The demo seed is **fictional** and is for local testing only. It must never be used as a real rental directory.

From the repository root, start PostgreSQL with `docker compose up -d postgres`. In this directory, copy `.env.example` to `.env`, run `npm ci`, `npm run db:generate`, `npm run db:deploy`, then `npm run dev`. The frontend runs separately in `uts-housing-frontend` with `npm ci` and `npm run dev`; Vite forwards `/api` to port 3001. Open `http://localhost:5173` in Chrome.

To add fictional demo accounts, a campus and a published sample listing, set `CONFIRM_DEMO_SEED=1` and run `npm run db:seed`. In PowerShell, use `$env:CONFIRM_DEMO_SEED='1'; npm run db:seed`. The local-only accounts are `admin@demo.local`, `landlord@demo.local`, `student@demo.local`, and `candidate@demo.local`; their initial password is `Demo12345!` unless `SEED_DEMO_PASSWORD` is set. The seed refuses `NODE_ENV=production` and non-local database hosts. The sample listing is explicitly labeled fictional and hides its exact pin by default.

Database changes are committed as SQL files in `prisma/migrations`. `npm run db:deploy` checks each migration's SHA-256 checksum and applies pending files in one PostgreSQL transaction under an advisory lock; it can be rerun safely. `npm run db:migrate` uses the same local migration executor. The Prisma Client still must be generated after changing `prisma/schema.prisma`.

The Google Maps browser key belongs in `uts-housing-frontend/.env` as `VITE_GOOGLE_MAPS_API_KEY`. Without one, listing coordinates can still be entered manually and an opted-in exact pin can open Google Maps in a new tab. Keep the key restricted to your site origin. Exact coordinates are shown only to a signed-in student when the listing owner enables publication, and to that listing's owner and admins.

Run `npm run typecheck`, `npm test`, and `npm run build` for API checks. The email worker runs separately with `npm run email:worker`; configure SMTP values in `.env` to deliver queued messages. In local development without SMTP, the worker writes email messages to `data/outbox` so verification and reset links can be tested. API transactions do not wait for delivery. Production requires SMTP.

On Windows, install Node.js 24 and Docker Desktop first. In PowerShell, use `Copy-Item .env.example .env` inside this directory before starting the API. Run the API, email worker, and frontend in separate PowerShell windows. The API is available only on your computer until you choose to deploy it.
