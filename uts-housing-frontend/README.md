# UTS Housing & Roommate Finder — frontend

React + TypeScript + Vite frontend for the product described in the supplied `PROJECT_REQUIREMENTS.md`. See [../FRONTEND_STATUS.md](../FRONTEND_STATUS.md) for the original gaps, implemented screens, and outstanding integration work.

## Run locally

Use Node 24 and npm. From this directory:

```bash
npm ci
npm run dev
```

In the cloud workspace, use `npm ci --cache /workspace/.npm` if the home directory is read-only. Vite serves the frontend and proxies `/api` to `http://127.0.0.1:3001` by default. Copy `.env.example` to a local `.env` only if you need to change the API base path or proxy target. Do not put secrets in `VITE_` variables; Vite exposes them to browser code.

The backend is not present in this repository. Without a running API, public pages show a connection error for live data and login or protected workflows cannot complete. The app does not substitute production mock records. The frontend expects the success envelope `{ "data": ... }`, error envelope `{ "error": { "code": "...", "message": "..." } }`, and HTTP-only cookie sessions from the requirements. It also accepts successful `204 No Content` responses.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The test suite covers selected form, API, listing, roommate privacy and administrator behavior. A passing frontend build does not demonstrate that the missing backend, email delivery, storage or deployment works. End-to-end browser and accessibility reviews are still required with a working API.

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
