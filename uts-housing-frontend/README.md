# UTS Housing & Roommate Finder — frontend

React + TypeScript + Vite frontend for the product described in the user's uploaded `PROJECT_REQUIREMENTS.md`. See [../FRONTEND_STATUS.md](../FRONTEND_STATUS.md) for the original gaps, implemented screens, and remaining environment and acceptance work.

## Run locally

On Windows, start the complete application from the repository root with `START-REAL-SITE.cmd`; see [WINDOWS_LOCAL_SETUP.md](../WINDOWS_LOCAL_SETUP.md). It serves this frontend at `http://localhost:5173` with the real API and PostgreSQL. The separate `127.0.0.1:4173` preview discards verification uploads and shows placeholder downloads.

Use Node 24 and npm. From this directory:

```bash
npm ci
npm run dev
```

In the cloud workspace, use `npm ci --cache /workspace/.npm` if the home directory is read-only. Vite serves the frontend and proxies `/api` to `http://127.0.0.1:3001` by default. Copy `.env.example` to a local `.env` only if you need to change the API base path or proxy target. Do not put secrets in `VITE_` variables; Vite exposes them to browser code.

The Express/PostgreSQL backend is in [`../uts-housing-api`](../uts-housing-api). Start PostgreSQL, run the API migration and optional fictional seed, and then start the API before opening the website. See the [repository guide](../README.md) for Windows and Chrome commands. The frontend expects the success envelope `{ "data": ... }`, error envelope `{ "error": { "code": "...", "message": "..." } }`, and HTTP-only cookie sessions. It also accepts successful `204 No Content` responses.

Listing owners enter a complete address; they can separately choose whether signed-in students see it after approval. Guests see only the approximate area. The site does not use an embedded map or ask landlords for coordinates, and address-only listings are not sorted by distance.

English is the default interface language. The navigation selector switches the site to Bahasa Melayu or Simplified Chinese and saves the choice in the browser. User-written messages, property titles and addresses are shown as entered. The messaging API verifies `expectedSenderId` against the cookie session so a reply drafted in an old tab cannot silently be sent as another signed-in account. Set `VITE_SUPPORT_EMAIL` to an approved public support mailbox when one is available; it is shown on Help and is never a secret.

For a new student account, registration requires a school email domain configured for an active campus (for example, `student.uts.edu.my`). The student verifies ownership through the emailed link, then opens Profile Settings to submit a Student ID photo (JPG/PNG) and offer letter (PDF/JPG/PNG). Both are required, with a 5 MB limit per file. Expired links can be requested again on Verify Email. The admin verification queue provides private download links for both documents and requires the reviewer to confirm that the Student ID on the card matches the school email prefix before approving. This is a human check, not OCR. The browser's file checks provide early feedback; the API repeats validation and controls access. The seeded `student@demo.local` and `candidate@demo.local` users are already verified demo accounts, so use a new fictional account to exercise the real application flow. Do not put real documents in the UI preview or repository.

A new landlord registers with a name, email and required phone number, then verifies their email. The landlord profile still contains only name, read-only account email and phone; the separate verification area accepts private identity documents. Each listing has a separate property authorization application, so approval of one property never covers another. Both reviews must be current before submitting a landlord listing for moderation, and listing moderation is still required before publication. Reviewers can set an earlier expiry, revoke a current approval, and require fresh evidence for renewal. Expired or revoked approvals immediately hide affected listings from public views and interactions. The landlord and administrators can see review status and rejection reasons. Browser upload checks offer early feedback, while the API enforces document and permission rules. Use only fictional documents for local testing.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:browser # after starting the local site and API, or point SMOKE_BASE_URL to the running preview
```

The test suite covers selected form, API, listing, roommate privacy and administrator behavior. The dependency-free Chrome smoke script checks navigation, translations and a narrow viewport; see [QA_CHECKLIST.md](QA_CHECKLIST.md) for the manual and end-to-end checks still needed. Run the API tests and local PostgreSQL integration checks separately. Production email, storage operations, and deployment need environment-specific configuration and review.

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
