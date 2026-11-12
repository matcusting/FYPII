# Implementation status and traceability

This document maps the FYP report (Chapters 1 and 4) and `PROJECT_REQUIREMENTS.md` to the code. Status values: **Done** = implemented and tested locally; **Partial** = implemented with a stated limitation; **Not done** = outside this iteration.

## Report objectives (Chapter 1.3)

| Objective | Where | Status |
|---|---|---|
| Centralised rental database with filtering by rent, deposit, facilities and distance | `backend/src/modules/listings.js`, `frontend/src/pages/student/HousingSearch.jsx` | Done |
| Habit-focused roommate matching and tagging | `backend/src/services/matching.js`, `modules/roommates.js`, `pages/student/RoommateSearch.jsx` | Done |
| Verified student review forum and rating system | `backend/src/modules/reviews.js`, `components/ListingReviews.jsx`, `pages/landlord/Reviews.jsx` | Done |

## Report Chapter 4 workflows

| Item | Implementation | Status |
|---|---|---|
| Fig 4.1: student authenticates with Student ID; failure shows an error and asks for a retry | `POST /auth/login` checks that the Student ID matches the e-mail | Done |
| Fig 4.2: habit matching gives a percentage score | `compatibility()`. With default weights it equals `C = (M_study + M_smoke + M_clean) / 3 × 100%` | Done |
| Fig 4.3: landlord listing validation, then storage, then "Active" | Zod validation, then the admin approval queue, then PUBLISHED | Done (an admin approval step was added, per the requirements) |
| Fig 4.4: three actors (Student, Landlord, Administrator) | Three role-protected portals | Done |
| ER model: Users, Landlords, Listings, Reviews | `prisma/schema.prisma` (22 tables) | Done |
| Limitation 5.2 #2: static weighting | Per-habit importance (1–3) | Done |
| Limitation 5.2 #3: manual availability updates | `lastConfirmedAt`, stale warning and "Confirm Still Available" | Partial (still landlord-reported) |
| Future work: ML matching | — | Not done (future work) |
| Future work: encrypted real-time chat | In-app messaging that polls every 5 s | Partial (not end-to-end encrypted, not WebSocket) |

## PROJECT_REQUIREMENTS.md functional requirements

| FR | Status | Notes |
|---|---|---|
| FR-01 Accounts | Done | Register, login, logout, logout from all devices, e-mail verification, reset, change password, deletion request, rate limiting, generic login errors, admin creation script only |
| FR-02 Student profile and lifestyle | Done | Profile, 6 habits, weights, budget, move-in date, discoverable opt-in, block |
| FR-03 Listings | Done | All 7 statuses, soft delete, at least 1 photo to publish, image type, size and count limits checked by file signature, stale flag, student sublets (verified students only) |
| FR-04 Search | Done | Keyword, rent, deposit, distance, room type, facilities, furnished, available-by, 4 sort orders, pagination, saved listings. Distance is entered by the landlord. The listing address opens in Google Maps (search link, or the landlord's own Google Maps pin if provided) |
| FR-05 Matching | Done | Eligibility filters, explainable breakdown, insufficient data shown instead of 0%, consent-based requests |
| FR-06 Reviews | Done | Verified students only, proof of stay checked by admin, one per listing, edit history, moderation, landlord reply, reporting |
| FR-07 Contact | Done | In-app inquiries, contact details never exposed, block and report, message rate limit, no payments |
| FR-08 Admin | Done | Verifications, listings, reviews, reports, users, campuses and domains, facilities, audit log |
| FR-09 Notifications | Done | In-app plus e-mail (SMTP or a dev log file). Failures never block the main request. No per-user opt-out settings yet |

## Security (section 11)

Done: Argon2id, opaque session tokens stored as SHA-256 hashes, HttpOnly + SameSite=Lax cookies (Secure in production), a new session on every login, sessions revoked on password reset and suspension, Origin-check CSRF protection, CORS limited to the frontend origin, Helmet headers, Zod validation of every input, parameterised Prisma queries, React escaping, upload signature checks, rate limits, record-level ownership checks that return 404, and no stack traces in responses.

## Not done / needs a decision

- **Public deployment:** no hosting account or domain has been provisioned (README → Deployment notes).
- **Object storage:** photos are on local disk. S3-compatible storage is needed before production.
- **Maps:** students open the listing address in Google Maps (no API key needed). Not done: automatic distance calculation, embedded map and address autocomplete, which would need a paid Google Maps API key.
- **Multilingual UI:** not required by the TRF.
- **Frontend unit tests and Playwright E2E in CI:** only the backend has automated tests. The UI flows were checked manually with Playwright during development.
- **Open questions for the supervisor:** see `PROJECT_REQUIREMENTS.md` §18 (verification policy, sublet rules, landlord identity checks, data retention).
