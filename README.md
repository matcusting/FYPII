# UTS Housing & Roommate Finder

A web-based housing rental and roommate matching system for students of the University of Technology Sarawak (UTS). This is the Final Year Project of Marcus Ting Zhong Sheng.

| Folder | What it is |
|---|---|
| `uts-housing-frontend/` | React 19 + Vite + Tailwind CSS single-page app (student, landlord and admin portals) |
| `uts-housing-backend/` | Node.js + Express REST API with Prisma ORM and PostgreSQL |
| `docs/` | Requirements traceability and API reference |
| `docker-compose.yml` | Local PostgreSQL for development |

> **Status:** working prototype that runs locally. It has **not** been deployed to a public server yet. The demo data is fictitious.

## Features

- **Accounts:** student and landlord registration, Argon2id password hashing, HTTP-only session cookies, e-mail verification, password reset, account deletion requests. Students can **only register with their university student e-mail** (`<studentId>@student.uts.edu.my`; domains are set by admins), and the Student ID must match the e-mail. Students log in with **Student ID + student e-mail + password**, and a mismatch shows an error so they can retry (report Fig 4.1).
- **Document-based verification:**
  - *Students* upload their **offer letter (PDF)** and a **student card photo**; an **administrator** reviews them.
  - *Landlords* upload their **identity card** (or company SSM registration) once; a **legal reviewer** (e.g. a lawyer working with the platform) verifies them. Landlords must be verified before they can submit a listing.
  - *Every property* needs its **ownership / right-to-rent documents** (title deed, or tenancy agreement + owner's authorisation). The legal reviewer checks them first, then the administrator checks the listing details before it goes live. Changing a listing's address requires new documents.
  - Documents are stored outside the public folder and only opened through an access check (uploader, administrators, and — for landlord/property documents only — legal reviewers). Every view by someone else is written to the audit log. PDF / JPG / PNG only (checked by file signature), 10 MB each.
- **Legal reviewer portal:** a separate login (“Staff login”) with two queues — property documents and landlord identity. Reviewers cannot see students, chats or the admin console. Admins create reviewer accounts; the reviewer sets a password from an e-mailed link.
- **Three languages:** English (default), Bahasa Melayu and 中文, switched with the 🌐 menu in every header and on the login / register pages. The choice is remembered in the browser. Translations live in `uts-housing-frontend/src/i18n/messages/` (English text is the key; missing translations fall back to English). Reference data and common API messages are translated in the browser; e-mails, notification bodies and user-written content stay as written. `npm run i18n:check` lists any untranslated strings.
- **Structured listings:** rent, deposit, distance to campus, room type, facilities, area, availability date, house rules, furnished flag and up to 6 photos. Listing status workflow: Draft → Pending Review → Active / Rejected → Paused / Rented. Students only see listings an admin has approved. Listings not reconfirmed for 30 days are flagged as stale and the owner is reminded; after 45 days they are paused automatically until the owner confirms them again.
- **Address → Google Maps:** landlords enter the property address (and can optionally paste a Google Maps share link for an exact pin). In the listing details students tap the address to open it in Google Maps. Addresses are only returned to logged-in users. Distance to campus is entered by the landlord.
- **Search:** keyword search; filters for max rent, distance, deposit, room type, facilities, furnished and available-by date; sorting; pagination; saved listings (wishlist).
- **Habit-based roommate matching:** uses the report's formula `C = (M_study + M_smoke + M_clean) / 3 × 100%`, extended with optional habits (noise, guests, pets), per-habit importance weights, smoke-free deal-breakers, budget and move-in overlap, opt-in discovery, connection requests, blocking and reporting.
- **Verified reviews:** only verified students can post a review (1–5 stars, written feedback, stay dates and a private proof-of-stay note). Each student can review a listing once. Reviews are moderated, edits go back to moderation, and the landlord can reply publicly but cannot edit the review.
- **Gender options:** students choose Male or Female when they register (existing students are asked in My Profile). In roommate matching they pick "Same gender only" (default) or "Any gender is fine"; students of another gender only appear if both chose "Any". Landlords mark each listing "All genders welcome", "Male tenants only" or "Female tenants only"; students see a badge, can hide rooms they cannot rent, and cannot send an inquiry about a room reserved for the other gender. Gender is only shown to students who could be matched, never on public pages.
- **Real-time messaging:** listing inquiries, accepted roommate connections and an Admin Support channel, delivered instantly over WebSocket (Socket.IO) with a typing indicator. Contact details stay private.
- **Admin console:** overview, student verification, legal reviewer accounts, listing approval (after the legal check) and suspension, review moderation, abuse reports, user suspension and deletion, campus and e-mail-domain configuration, and an audit log.
- **Notifications:** in-app bell updated in real time, plus e-mail for verification, reset, moderation decisions, inquiries, roommate requests and availability reminders. Users can turn the non-security e-mails off. Without SMTP configured, e-mails are written to the console and `logs/mail.log`.
- **Responsive UI:** the original desktop design is kept, and pages also work at phone width.

## Running locally

Requirements: Node.js 20+ and PostgreSQL 16, either installed locally or started with Docker.

1. Start the database:

```bash
docker compose up -d
```

2. Set up the backend, then start it (http://localhost:4000):

```bash
cd uts-housing-backend
cp .env.example .env
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

3. In a second terminal, start the frontend (http://localhost:5173):

```bash
cd uts-housing-frontend
npm install
npm run dev
```

If PostgreSQL is installed without Docker, create the user `uts`, the database `uts_housing` (and `uts_housing_test` for tests), or change `DATABASE_URL` in `.env`.

### Demo accounts (created by `npm run db:seed`)

| Role | Login | Password |
|---|---|---|
| Student | Student ID `BCS24020031`, e-mail `bcs24020031@student.uts.edu.my` | `Demo@2026` |
| Landlord | `wong@example.com` | `Demo@2026` |
| Admin | "Staff login" link → `admin@uts-housing.local` | `Admin@2026!` |
| Legal reviewer (fictitious) | "Staff login" link → `reviewer@uts-housing.local` | `Review@2026!` |

The demo data includes items waiting for review: student *Priya Nair* (offer letter + student card, admin queue), landlord *Mr. Lim* (identity card, reviewer queue) and the listing *Master Room near Lanang Road* (title deed, reviewer queue). All demo documents are generated placeholders marked "DEMO DOCUMENT - FICTITIOUS".

In development the login form is pre-filled with these accounts. For a real deployment, create the first admin with `npm run create-admin -- "Name" email@domain`. Admins cannot self-register. Legal reviewers are added by an admin in **Legal Reviewers** (get the reviewer's agreement first — they will see landlords' personal documents).

## Tests

Run the backend tests:

```bash
cd uts-housing-backend
npm test
```

Lint and build the frontend:

```bash
cd uts-housing-frontend
npm run lint
npm run build
```

The backend suite (Vitest + Supertest + Socket.IO client, 40 tests) covers student e-mail rules, document verification and access control, the legal review flow, the matching formula, gender filters and restricted listings, the address / Google Maps link rules, the availability job, real-time chat and the acceptance scenarios: verification gates, listing moderation, search filters, ownership checks, deal-breaker exclusion, review eligibility and moderation, single-use reset tokens, upload validation, CSRF blocking and suspension. The tests run against the separate `uts_housing_test` database. GitHub Actions (`.github/workflows/ci.yml`) runs the same checks on every push.

## Deployment notes

The code is ready to deploy but has not been deployed. Typical setup:

- Frontend: static build on Vercel or Cloudflare Pages, with an SPA fallback to `index.html`.
- Backend: a Node host such as Render or Railway.
- Database: managed PostgreSQL. Run `npm run db:deploy` on each release.
- Production settings: `NODE_ENV=production` (secure cookies), `FRONTEND_ORIGIN`, `SMTP_URL`.
- Hosting both under one site (for example `housing.example.com` and `api.housing.example.com`), or proxying `/api` and `/socket.io` (with WebSocket upgrade enabled), keeps the SameSite=Lax session cookie working for both REST and real-time connections.
- Run a single API instance (the real-time layer and the availability job run in-process). Scaling to several instances would need the Socket.IO Redis adapter.
- Photos are stored on local disk (`UPLOAD_DIR`). Use a persistent volume or move them to S3-compatible storage before going live.
- Verification documents are stored in `PRIVATE_UPLOAD_DIR` (default `private-uploads/`). Never serve this folder publicly; back it up with the database, use encrypted storage in production, and agree a retention period (see PDPA notes in `PROJECT_REQUIREMENTS.md` §11).

See `docs/IMPLEMENTATION_STATUS.md` for what is implemented against the report and `PROJECT_REQUIREMENTS.md`, and what is still open.
