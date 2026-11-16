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
| Limitation 5.2 #3: manual availability updates | `services/jobs.js`: reminder after 30 days, automatic pause after 45 days, one-click "Confirm Still Available" restores it | Done (availability is still reported by the landlord, but stale rooms are hidden automatically) |
| Future work: ML matching | — | Not done (future work) |
| Future work: encrypted real-time chat | `src/realtime.js` (Socket.IO): messages, typing indicator and notifications pushed instantly, cookie-authenticated, origin-restricted, encrypted in transit with HTTPS/WSS in production | Partial (real-time done; not end-to-end encrypted, because admins must be able to review reported messages) |

## PROJECT_REQUIREMENTS.md functional requirements

| FR | Status | Notes |
|---|---|---|
| FR-01 Accounts | Done | Register (students: university student e-mail only, Student ID must match the e-mail), login, logout, logout from all devices, e-mail verification, reset, change password, deletion request, rate limiting, generic login errors, admin creation script only; legal reviewer accounts created by admins |
| FR-02 Student profile and lifestyle | Done | Profile, gender (required), 6 habits, weights, roommate gender preference, budget, move-in date, discoverable opt-in, block |
| FR-03 Listings | Done | All 7 statuses, soft delete, at least 1 photo and at least 1 ownership / right-to-rent document to submit, legal check by the legal reviewer before admin approval, new documents required after an address change, image type, size and count limits checked by file signature, stale flag, student sublets (verified students only), verified landlords only |
| FR-04 Search | Done | Keyword, rent, deposit, distance, room type, facilities, furnished, available-by, 4 sort orders, pagination, saved listings. Distance is entered by the landlord. The listing address opens in Google Maps (search link, or the landlord's own Google Maps pin if provided) |
| FR-05 Matching | Done | Eligibility filters, explainable breakdown, insufficient data shown instead of 0%, consent-based requests |
| FR-06 Reviews | Done | Verified students only, proof of stay checked by admin, one per listing, edit history, moderation, landlord reply, reporting |
| FR-07 Contact | Done | In-app inquiries, contact details never exposed, block and report, message rate limit, no payments |
| FR-08 Admin | Done | Student verification (offer letter + student card), legal reviewer accounts, listings (after the legal check), reviews, reports, users, campuses and domains (incl. Student-ID-in-e-mail rule), facilities, audit log (incl. every document view). Landlord identity and property documents are reviewed in the separate legal reviewer portal |
| FR-09 Notifications | Done | In-app (pushed in real time) plus e-mail (SMTP or a dev log file) for listing decisions, inquiries, roommate requests and availability reminders. Users can switch e-mails off in account settings; security e-mails are always sent. Failures never block the main request |

## Security (section 11)

Done: Argon2id, opaque session tokens stored as SHA-256 hashes, HttpOnly + SameSite=Lax cookies (Secure in production), a new session on every login, sessions revoked on password reset and suspension, Origin-check CSRF protection, CORS limited to the frontend origin, Helmet headers, Zod validation of every input, parameterised Prisma queries, React escaping, upload signature checks, rate limits, record-level ownership checks that return 404, and no stack traces in responses.

## Not done / needs a decision

- **Public deployment:** no hosting account or domain has been provisioned (README → Deployment notes).
- **Object storage:** photos are on local disk. S3-compatible storage is needed before production.
- **Maps:** students open the listing address in Google Maps (no API key needed). Distance is entered by the landlord: automatic distance from a map pin was built and then removed on feedback (see the `claude/jolly-edison-1vzpxr` history). Not done: embedded map and address autocomplete, which would need a paid Google Maps API key.
- **Multilingual UI:** not required by the TRF.
- **Frontend unit tests and Playwright E2E in CI:** only the backend has automated tests. The UI flows were checked manually with Playwright during development.
- **Document retention:** verification documents are kept (superseded property documents too, for the audit trail). A retention period and automatic deletion still need to be decided (PDPA).
- **Open questions for the supervisor:** see `PROJECT_REQUIREMENTS.md` §18 (sublet rules, data retention). Decided in this iteration: students are verified by offer letter + student card (admin); landlords and properties by a legal reviewer.

## FYP II iteration (November 2026)

| Change | Files | Evidence |
|---|---|---|
| Real-time chat, typing indicator and notifications over WebSocket (fallback polling only while offline) | `backend/src/realtime.js`, `frontend/src/lib/socket.js`, `hooks/useConversations.js` | `tests/fyp2.test.js` → "real-time messaging" (auth rejection, delivery to participants only, logout disconnect); checked in the browser with two accounts |
| Availability upkeep job (remind at 30 days, auto-pause at 45 days) | `backend/src/services/jobs.js` | `tests/fyp2.test.js` → "listing availability upkeep" |
| E-mail notification preference | `services/notify.js`, `components/AccountSections.jsx` | `tests/fyp2.test.js` → "notification preferences" |
| Gender options: required student gender, "same gender only / any" roommate filter, male-only / female-only listings with search filter and inquiry check | `prisma/migrations/20261116110000_gender_options`, `services/matching.js` (`genderConflict`), `modules/roommates.js`, `modules/listings.js`, `modules/conversations.js`, `pages/Register.jsx`, `pages/student/Profile.jsx`, `RoommateSearch.jsx`, `HousingSearch.jsx`, `AddListing.jsx`, `ManageListings.jsx` | `tests/matching.test.js` → "roommate gender filter"; `tests/fyp2.test.js` → "gender options" (registration, matching, restricted listings, search, inquiries, privacy); checked in the browser |
| `prisma generate` runs automatically after `npm install` | `backend/package.json` | — |

| Document-based verification: student e-mail only registration; students upload offer letter + student card (admin reviews); landlords upload identity documents once and every property's ownership documents (legal reviewer reviews); private document storage with access checks and audit log; legal reviewer role and portal | `prisma/migrations/20261116120000_document_verification`, `services/documents.js`, `modules/documents.js`, `modules/reviewer.js`, `modules/profile.js`, `modules/listings.js`, `modules/admin.js`, `modules/auth.js`, `components/AccountSections.jsx`, `components/Documents.jsx`, `components/PropertyDocuments.jsx`, `pages/reviewer/ReviewerPortal.jsx`, `pages/admin/AdminSections.jsx`, `pages/Register.jsx`, `pages/Login.jsx` | `tests/documents.test.js` (file-type checks, who can open which document, 404 for others, audit log, admin vs reviewer permissions, reject → fix → approve → publish, address change, reviewer account setup); `tests/api.test.js` (student e-mail rules); checked in the browser as reviewer and admin |

Backend test suite: 40 tests (23 from FYP I + 17 new).

Known local issue: on Windows with Node 24, a test run occasionally (about 1 in 8) aborts with a native worker crash (exit code 3221226505) before finishing; no test has failed. It also happens with only the FYP I tests, so it is an environment issue (native modules), not a test failure. Rerun, or use Node 22 as in CI.
