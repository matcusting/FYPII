# UTS Housing & Roommate Finder

A local development build of the student housing project. The React website and Express/PostgreSQL API cover accounts, student verification, moderated property listings, search and favorites, roommate matching, inquiries and consent-based messaging, rental-proof reviews, reports, notifications, and administration. The website keeps its existing visual style. English is the default interface language; users can switch to Bahasa Melayu or Simplified Chinese. The seeded accounts and property are fictional.

## Open locally on Windows

Install Node.js 24, Git and Docker Desktop. Open PowerShell, clone this branch, and enter the repository folder:

```powershell
git clone -b codex/frontend-preview https://github.com/matcusting/FYPII.git
cd FYPII
```

Start PostgreSQL and the API:

```powershell
docker compose up -d postgres
cd uts-housing-api
Copy-Item .env.example .env
npm ci
npm run db:generate
npm run db:deploy
$env:CONFIRM_DEMO_SEED='1'; npm run db:seed
npm run dev
```

Keep that window open. Open a second PowerShell window in `uts-housing-api` and start the email worker:

```powershell
npm run email:worker
```

Open a third PowerShell window in `uts-housing-frontend`:

```powershell
npm ci
npm run dev
```

Open **http://localhost:5173** in Chrome. The local demo accounts are `student@demo.local`, `candidate@demo.local`, `landlord@demo.local`, and `admin@demo.local`, with password `Demo12345!`. They exist only after the optional seed command. Never use fictional records to arrange a real rental. Stop the API, worker, and Vite with Ctrl+C; stop PostgreSQL with `docker compose down` when finished.

The application uses the real local API and database. The older `uts-housing-frontend/preview` server is a separate, temporary in-memory UI preview. Changes made in that preview disappear when it stops.

The language selector is available in the site navigation and role dashboards. It remembers the choice in this browser. Chat messages and user-entered listing text stay in their original language. If you switch accounts in another browser tab, the message composer resets its draft; reload any older tab before sending a reply. The API checks that the sender shown by the browser is still the signed-in account.

## Google Maps and location privacy

The landlord can save coordinates and a street address, and can choose whether to share the exact pin. An approved listing's exact pin is shown only to signed-in students after the landlord opts in; its owner and administrators can also view it. Other visitors see an approximate area and distance. If there is no Google Maps API key, the listing form accepts coordinates and eligible viewers can open the pin on Google Maps in a new tab.

To enable the embedded interactive map, create a browser key in Google Cloud, enable **Maps JavaScript API**, enable billing, and restrict the key to your website's HTTP referrers (for local use, `http://localhost:5173/*`). Put it in `uts-housing-frontend/.env`:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=your_browser_key
```

The key is browser-visible configuration; do not put server secrets in a `VITE_` variable. Restart Vite after changing the file. A Google key has not been supplied, so the embedded map has not been tested against a live Google account.

## Checks and project files

Run `npm run typecheck`, `npm test`, and `npm run build` in both `uts-housing-api` and `uts-housing-frontend`. Run `npm run lint` in the frontend. API integration tests can use a migrated disposable PostgreSQL database via `TEST_DATABASE_URL`. CI performs these checks and applies the committed SQL migration to its test database.

The [API guide](uts-housing-api/README.md) explains migration, seed, and email behavior. [Frontend guide](uts-housing-frontend/README.md) describes its routes. The user's uploaded `PROJECT_REQUIREMENTS.md` is the product blueprint; its checklist was not evidence of completed work. Deployment, real Google billing/key, provider SMTP, backups, and production monitoring still require environment-specific setup and review.
