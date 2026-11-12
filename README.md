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

- **Accounts and verification:** student and landlord registration, Argon2id password hashing, HTTP-only session cookies, e-mail verification, password reset, account deletion requests. Students log in with **Student ID + UTS e-mail + password**, and a mismatch shows an error so they can retry (report Fig 4.1). E-mails on a configured UTS domain are verified automatically. Other students and all landlords go to an admin review queue.
- **Structured listings:** rent, deposit, distance to campus, room type, facilities, area, availability date, house rules, furnished flag and up to 6 photos. Listing status workflow: Draft → Pending Review → Active / Rejected → Paused / Rented. Students only see listings an admin has approved. Listings not reconfirmed for 30 days are flagged as stale.
- **Address → Google Maps:** landlords enter the property address (and can optionally paste a Google Maps share link for an exact pin). In the listing details students tap the address to open it in Google Maps. Addresses are only returned to logged-in users. Distance to campus is entered by the landlord.
- **Search:** keyword search; filters for max rent, distance, deposit, room type, facilities, furnished and available-by date; sorting; pagination; saved listings (wishlist).
- **Habit-based roommate matching:** uses the report's formula `C = (M_study + M_smoke + M_clean) / 3 × 100%`, extended with optional habits (noise, guests, pets), per-habit importance weights, smoke-free deal-breakers, budget and move-in overlap, opt-in discovery, connection requests, blocking and reporting.
- **Verified reviews:** only verified students can post a review (1–5 stars, written feedback, stay dates and a private proof-of-stay note). Each student can review a listing once. Reviews are moderated, edits go back to moderation, and the landlord can reply publicly but cannot edit the review.
- **In-app messaging:** listing inquiries, accepted roommate connections and an Admin Support channel. Contact details stay private.
- **Admin console:** overview, student and landlord verification, listing approval and suspension, review moderation, abuse reports, user suspension and deletion, campus and e-mail-domain configuration, and an audit log.
- **Notifications:** in-app bell, plus e-mail for verification, reset and moderation decisions. Without SMTP configured, e-mails are written to the console and `logs/mail.log`.
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
| Student | Student ID `BCS24020031`, e-mail `student@uts.edu.my` | `Demo@2026` |
| Landlord | `wong@example.com` | `Demo@2026` |
| Admin | "Administrator login" link → `admin@uts-housing.local` | `Admin@2026!` |

In development the login form is pre-filled with these accounts. For a real deployment, create the first admin with `npm run create-admin -- "Name" email@domain`. Admins cannot self-register.

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

The backend suite (Vitest + Supertest, 23 tests) covers the matching formula, the address / Google Maps link rules and the acceptance scenarios: verification gates, listing moderation, search filters, ownership checks, deal-breaker exclusion, review eligibility and moderation, single-use reset tokens, upload validation, CSRF blocking and suspension. The tests run against the separate `uts_housing_test` database. GitHub Actions (`.github/workflows/ci.yml`) runs the same checks on every push.

## Deployment notes

The code is ready to deploy but has not been deployed. Typical setup:

- Frontend: static build on Vercel or Cloudflare Pages, with an SPA fallback to `index.html`.
- Backend: a Node host such as Render or Railway.
- Database: managed PostgreSQL. Run `npm run db:deploy` on each release.
- Production settings: `NODE_ENV=production` (secure cookies), `FRONTEND_ORIGIN`, `SMTP_URL`.
- Hosting both under one site (for example `housing.example.com` and `api.housing.example.com`), or proxying `/api`, keeps the SameSite=Lax session cookie working.
- Photos are stored on local disk (`UPLOAD_DIR`). Use a persistent volume or move them to S3-compatible storage before going live.

See `docs/IMPLEMENTATION_STATUS.md` for what is implemented against the report and `PROJECT_REQUIREMENTS.md`, and what is still open.
