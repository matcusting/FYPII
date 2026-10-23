# UTS Housing & Roommate Finder — frontend

React + TypeScript + Vite frontend for the product described in the user's uploaded `PROJECT_REQUIREMENTS.md`. See [../FRONTEND_STATUS.md](../FRONTEND_STATUS.md) for the original gaps, implemented screens, and remaining environment and acceptance work.

## Run locally

Use Node 24 and npm. From this directory:

```bash
npm ci
npm run dev
```

In the cloud workspace, use `npm ci --cache /workspace/.npm` if the home directory is read-only. Vite serves the frontend and proxies `/api` to `http://127.0.0.1:3001` by default. Copy `.env.example` to a local `.env` only if you need to change the API base path or proxy target. Do not put secrets in `VITE_` variables; Vite exposes them to browser code.

The Express/PostgreSQL backend is in [`../uts-housing-api`](../uts-housing-api). Start PostgreSQL, run the API migration and optional fictional seed, and then start the API before opening the website. See the [repository guide](../README.md) for Windows and Chrome commands. The frontend expects the success envelope `{ "data": ... }`, error envelope `{ "error": { "code": "...", "message": "..." } }`, and HTTP-only cookie sessions. It also accepts successful `204 No Content` responses.

Set `VITE_GOOGLE_MAPS_API_KEY` in a local `.env` to turn on the interactive Google map. Without the key, the landlord can enter coordinates manually and eligible students can open an opted-in exact pin on Google Maps. The backend controls who may receive exact coordinates.

English is the default interface language. The navigation selector switches the site to Bahasa Melayu or Simplified Chinese and saves the choice in the browser. User-written messages, property titles and addresses are shown as entered. Google Maps labels use the language active when its script first loads; refresh the page after changing language to update those labels. The messaging API verifies `expectedSenderId` against the cookie session so a reply drafted in an old tab cannot silently be sent as another signed-in account.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The test suite covers selected form, API, listing, roommate privacy and administrator behavior. Run the API tests and local PostgreSQL integration checks separately. Production email, Google Maps, storage operations, and deployment need environment-specific configuration and review.

## Project structure

- `src/App.tsx`: routes and role guards.
- `src/components/SiteLayout.tsx`: shared navigation and mobile menu.
- `src/features/public`: landing, login, registration, verification, recovery, legal/help and 404 pages.
- `src/features/listings`: public listings, favorites, reviews, inquiries and listing management.
- `src/features/roommates`: lifestyle profile, privacy settings, matches and connection actions.
- `src/features/account`: account profile, verification, requests, sessions and notification settings.
- `src/features/admin`: moderation, account controls and campus settings.
- `src/lib`: cookie-aware API transport, auth state and shared types.

Frontend route guards improve navigation and messaging; the backend must enforce authorization, ownership, moderation and CSRF protection for every operation.
