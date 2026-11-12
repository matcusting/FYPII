# Student Housing & Roommate Finder

> **Final Year Project — Complete Product Requirements, Architecture & Implementation Blueprint**  
> **Official TRF title:** A Web-based Housing Rental and Roommate Matching System for University Students  
> **Project category:** System/Application Development  
> **Institution:** University of Technology Sarawak (UTS)  
> **Status:** Proposed architecture and development specification — **not an implemented or deployed application**.

## 1. Document provenance and scope

**Source A: Title Registration Form (TRF), pages 1–2.** The TRF defines the project, intended audience, core pain points and proposed features. The short title on page 2 is *Student Housing & Roommate Finder*. Its proposed stack offers alternatives (React/Vue, Node/Python, MySQL/PostgreSQL), not a finalized selection.

**Source B: FYP Originality Report, pages 1–4.** This is a Turnitin originality record (overall similarity index 3%), **not** the full thesis, requirements specification, architecture or implementation report. It does not provide additional system features.

**Traceability convention:** `[TRF]` = explicitly described in TRF; `[DESIGN]` = engineering decision proposed here to make the system buildable; `[OPTIONAL]` = potential future extension. No feature in this file should be represented as already completed.

## 2. Executive summary

A responsive student-oriented rental marketplace and roommate discovery platform. Students can find and sublet campus-related accommodation, filter listings by availability, price and distance, create lifestyle profiles and discover compatible roommates. Local landlords can manage structured listings. Verified students can review landlords and properties. Administrators oversee verification, listings, moderation and safety.

### 2.1 Problems addressed [TRF]
- Rental information is scattered among Telegram groups and mass emails.
- Students struggle to search for rooms meeting specific criteria.
- Incompatible lifestyle habits (e.g. smoking and study schedules) cause roommate conflicts.
- Generic marketplaces include irrelevant or potentially fraudulent listings.

### 2.2 Intended benefits [TRF]
- Persistent, centralized searchable rental database.
- Price, distance and real-time availability filtering.
- Lifestyle-based roommate discovery.
- Student-only, verified feedback on landlords and listings.

### 2.3 Success criteria [DESIGN]
- A student can register, verify student status, browse and filter available listings.
- A landlord can submit a listing with price, deposit, amenities and photos; the listing enters moderation.
- A student can create a roommate profile and see explainable compatibility scores.
- Only verified students can submit a moderated review; duplicate and abusive reviews are controlled.
- Admins can approve listings, manage reports and verify accounts.
- End-to-end flows work in staging and production over HTTPS.

## 3. Recommended technology stack [DESIGN]

| Layer | Selection | Reason |
|---|---|---|
| Frontend | React + TypeScript + Vite | Responsive, maintainable component-based SPA |
| Styling | Tailwind CSS | Mobile-first UI |
| Routing | React Router | Public and role-protected pages |
| Forms | React Hook Form + Zod | Typed form validation |
| Data fetching | TanStack Query | Caching, loading and error states |
| Backend | Node.js + TypeScript + Express | REST API, clear modular services |
| ORM | Prisma | Migrations and type-safe data access |
| Database | PostgreSQL | Relational integrity and structured filtering |
| Authentication | Email/password + secure HTTP-only session cookies | Server-controlled session lifecycle |
| Passwords | Argon2id | Strong password hashing |
| Image storage | S3-compatible object storage | Photos stored outside database |
| Email | Transactional email provider | Verification and password reset |
| Frontend hosting | Vercel or Cloudflare Pages | Static React build and CDN |
| Backend hosting | Render, Railway or comparable Node host | Long-running Express service |
| Database hosting | Managed PostgreSQL | Backups, TLS, operational maintenance |
| Monitoring | Provider logs + Sentry (optional) | Operational visibility |
| CI/CD | GitHub Actions | Automated lint, tests, builds and deployments |

The TRF permits alternative frameworks; this document **chooses one coherent stack** rather than claiming the TRF mandates it. Check current provider pricing, availability and terms before provisioning.

## 4. User roles and access control

| Action | Guest | Student (unverified) | Verified student | Landlord | Admin |
|---|---|---|---|---|---|
| Browse public approved listings | Yes | Yes | Yes | Yes | Yes |
| Filter and view listing details | Yes | Yes | Yes | Yes | Yes |
| Save favorites | No | Yes | Yes | Yes | Yes |
| Manage own roommate profile | No | Yes | Yes | No | No |
| View roommate discovery | No | Limited | Yes | No | Yes (moderation only) |
| Post room/sublet listing | No | Draft | Yes | Yes | Yes |
| Manage own listing | No | Own draft | Own | Own | All |
| Write landlord/listing reviews | No | No | Yes | No | Moderate |
| Submit reports | No | Yes | Yes | Yes | Yes |
| Verify students / moderate content | No | No | No | No | Yes |

**Rules [DESIGN]:** Roles are assigned server-side. A user may be a student who also posts a sublet; support this using a user-role relation or student listing ownership. Landlords do not receive student-only review privileges. Never trust frontend route guards as authorization. Every backend endpoint enforces role and resource ownership.

## 5. Functional requirements

### FR-01 Account registration, login and recovery [DESIGN]
- Register as student or landlord with name, email, password and acceptance of terms.
- Require verified email before privileged actions.
- Student verification through approved university email domain **or** manual review; configurable domains, not a hard-coded assumption.
- Login, logout, password reset, account deletion request, session revocation.
- Rate-limit login and verification endpoints; generic errors for unknown emails.
- Admin accounts are provisioned securely, not self-registered as admins.

### FR-02 Student profile and lifestyle questionnaire [TRF + DESIGN]
- Profile: display name, university, short biography, preferred location, budget range, preferred move-in date.
- Lifestyle: smoking preference, study hours, sleep schedule, cleanliness level, noise tolerance, guest frequency, pets preference.
- Select roommate preferences and optional importance weights.
- Make sensitive or optional profile fields private by default; explicit opt-in for discovery.
- Student can pause discovery, block users and remove their profile.

### FR-03 Structured housing listings [TRF + DESIGN]
- Create/edit/delete (soft-delete) listings: title, description, property type, room type, monthly rent, currency, deposit, facilities/amenities, house rules, location, photo gallery, contact method, availability dates, status.
- Listing statuses: `DRAFT`, `PENDING_REVIEW`, `PUBLISHED`, `REJECTED`, `PAUSED`, `RENTED`, `ARCHIVED`.
- At least one photo required for publication; limit image size/type and count.
- Only approved listings appear publicly. Owners can manage their own listings.
- Availability is owner-reported and timestamped, **not guaranteed live inventory**; prompt owners to reconfirm and mark stale listings.
- Students can post sublets subject to university/lease rules; no assumption that subletting is legally permitted in all circumstances.

### FR-04 Search, filtering and discovery [TRF + DESIGN]
- Search by keyword, area and university.
- Filters: minimum/maximum rent, available date, distance to selected campus, room/property type, amenities, deposit range, furnished status.
- Sorting: newest, rent ascending/descending, distance.
- Pagination, empty state, saved listings, clear filters.
- Campus coordinates are admin-configured. Calculate approximate straight-line distance with PostGIS or Haversine; label it as approximate, **not driving distance**.

### FR-05 Roommate matching [TRF + DESIGN]
- Find other opted-in, verified student profiles.
- Filter by budget overlap, location, intended move-in period and deal-breakers (e.g. smoking, pets).
- Rank remaining candidates using an explainable weighted compatibility score (section 8).
- Show compatibility percentage and top contributing preferences, not a claim of scientific psychological compatibility.
- Support privacy controls, block/report and consent-based connection requests.

### FR-06 Reviews and ratings [TRF + DESIGN]
- Verified students can review a landlord and/or listing, with rating 1–5, written feedback and timestamp.
- Review eligibility: verified student plus evidence of genuine rental experience or moderator-approved proof; verification status alone does **not** prove a rental experience.
- One active review per student per listing per rental experience; edits retain audit history.
- Reviews enter moderation; owners may respond but cannot alter review content.
- Report harassment, defamation, personal data and fabricated claims.
- Ratings are displayed with review counts; no fake sample ratings in production.

### FR-07 Contact and requests [DESIGN]
- Student submits an inquiry about a listing or sends a roommate connection request.
- Recipient can accept/decline; expose contact details only after appropriate consent.
- Use in-app messaging or masked contact form for MVP; email notifications optional.
- Block, report and spam-rate-limit interactions.
- **No rental payment processing in MVP.** Payments, tenancy contracts and deposits are handled outside the platform; avoid implying escrow protection.

### FR-08 Administration and trust [DESIGN]
- Dashboard of pending student verifications, landlord accounts, listings, reviews and reports.
- Approve/reject listings with reasons; moderate reviews and reported users.
- Manage university/campus records and verification domains.
- Audit log of sensitive admin actions; suspend accounts and listings.
- Never expose verification documents publicly; set restricted access and deletion policy.

### FR-09 Notifications [DESIGN]
- Email verification, password reset, listing approval/rejection, inquiry, connection request.
- User-configurable nonessential notifications and opt-out.
- Notifications must be queued or retried without blocking core transactions.

## 6. Frontend implementation plan

### 6.1 Routes and screens

| Route | Screen | Access |
|---|---|---|
| `/` | Landing page, search entry, featured listings | Public |
| `/listings` | Listing search with filters, sorting and pagination | Public |
| `/listings/:id` | Listing detail, photos, map/area, inquiry, reviews | Public |
| `/login` | Sign in | Public |
| `/register` | Student/landlord registration | Public |
| `/verify-email` | Email verification result | Public |
| `/forgot-password` | Password reset request | Public |
| `/reset-password` | Set new password with token | Public |
| `/dashboard` | Role-aware overview | Authenticated |
| `/profile` | Account and preferences | Authenticated |
| `/favorites` | Saved listings | Authenticated |
| `/my-listings` | Listing management | Authorized poster |
| `/listings/new` | New listing form | Authorized poster |
| `/listings/:id/edit` | Edit owned listing | Owner/admin |
| `/roommates` | Roommate search and matching | Verified student |
| `/roommates/profile` | Lifestyle questionnaire and privacy | Student |
| `/roommates/:id` | Consent-limited roommate profile | Verified student |
| `/requests` | Inquiries and connection requests | Authenticated |
| `/reviews/mine` | Review history | Verified student |
| `/admin` | Admin overview | Admin |
| `/admin/verifications` | Student verification queue | Admin |
| `/admin/listings` | Listing moderation | Admin |
| `/admin/reviews` | Review moderation | Admin |
| `/admin/reports` | Abuse reports | Admin |
| `/admin/campuses` | Campus and domain configuration | Admin |
| `/privacy`, `/terms`, `/help` | Legal and help pages | Public |
| `*` | 404 page | Public |

### 6.2 UI components
- `Navbar`, `MobileMenu`, `Footer`, `LanguageSelector` (optional), `AuthGuard`, `RoleGuard`.
- `ListingCard`, `ListingGallery`, `ListingFilters`, `PriceRange`, `AvailabilityBadge`, `FavoriteButton`.
- `LifestyleForm`, `MatchCard`, `CompatibilityBreakdown`, `ConnectionRequestButton`.
- `RatingStars`, `ReviewForm`, `ReportDialog`, `AdminModerationTable`.
- Shared `FormField`, `ErrorBanner`, `EmptyState`, `LoadingSkeleton`, `ConfirmDialog`, `Pagination`.

### 6.3 UX requirements
- Responsive layouts at mobile, tablet and desktop sizes; keyboard accessible forms and dialogs.
- WCAG 2.2 AA as accessibility target; labeled controls, visible focus, sufficient contrast.
- Clear loading, validation, network-error, permission-denied and no-results states.
- Do not publish exact home address by default; show approximate area until consent.
- All API data is untrusted and must be safely rendered.

## 7. Backend architecture

Modular monolith with REST API, keeping deployment manageable for FYP:

```text
Browser (React SPA)
       |
       | HTTPS + credentials
       v
Express API (Node.js)
  |-- Auth & sessions
  |-- Users / student verification
  |-- Listings / media / availability
  |-- Search / campus distance
  |-- Lifestyle profiles / matching
  |-- Inquiries / connection requests
  |-- Reviews / reports / moderation
  |-- Admin / audit / notifications
       |              |             |
       v              v             v
  PostgreSQL     Object storage   Email provider
```

### 7.1 Suggested source structure

```text
student-housing-finder/
├── README.md
├── PROJECT_REQUIREMENTS.md
├── .gitignore
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── web/
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── app/           # providers, routes, layouts
│   │   │   ├── components/    # reusable UI
│   │   │   ├── features/      # auth, listings, roommates, reviews, admin
│   │   │   ├── lib/           # typed API client, validation, utilities
│   │   │   ├── hooks/
│   │   │   └── main.tsx
│   │   └── vite.config.ts
│   └── api/
│       ├── src/
│       │   ├── app.ts
│       │   ├── server.ts
│       │   ├── config/
│       │   ├── middleware/    # auth, RBAC, errors, rate limit
│       │   ├── modules/       # one module per domain
│       │   ├── jobs/
│       │   └── utils/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/
│       │   └── seed.ts
│       └── tests/
├── packages/
│   └── shared/               # DTOs and Zod schemas
├── docs/
│   ├── api.md
│   ├── deployment.md
│   ├── database.md
│   └── testing.md
├── .github/workflows/ci.yml
└── docker-compose.yml        # local PostgreSQL only
```

### 7.2 Backend conventions
- Base path `/api/v1`; JSON input/output; use appropriate HTTP status codes.
- Zod validate all input, including query parameters and uploaded metadata.
- Centralized error handler; never return stack traces to clients.
- Transactional updates for reviews, listing status changes and request acceptance.
- Cursor or offset pagination with hard server-side limits.
- DB indexes on frequently filtered columns; no N+1 queries.
- Object uploads via short-lived signed URLs; verify uploaded content type and size server-side.
- Health checks: `/health/live` and `/health/ready`.

## 8. Roommate compatibility algorithm [DESIGN]

**This is a proposed transparent heuristic, not a model claimed in the TRF.**

### 8.1 Eligibility filters
1. Both students verified and opted into discovery.
2. Neither student blocked the other.
3. Budget ranges overlap (if marked as mandatory).
4. Move-in windows overlap within configurable tolerance.
5. No incompatible hard constraints, e.g. smoke-free-only vs smoker.

### 8.2 Weighted scoring

For compatible candidates, assign each dimension a similarity score `s_i` in `[0,1]`, where 1 is aligned and 0 is maximally different. Example weights:

| Dimension | Weight |
|---|---:|
| Smoking preference | 25% |
| Study/sleep schedule | 20% |
| Cleanliness | 20% |
| Noise tolerance | 15% |
| Guests/social habits | 10% |
| Pets preference | 10% |

`score = round(100 * sum(w_i * s_i) / sum(w_i for answered dimensions))`

Missing answers are excluded from numerator and denominator; if none overlap, return **insufficient data**, not 0%. Hard conflicts remove candidates rather than awarding a misleading low score. Use a minimum answered-dimension threshold (e.g. 3) before displaying a percentage. Sort by score, then relevant location/budget fit; explain which habits match and allow users to revise their preferences. Do not infer sensitive characteristics or guarantee real-life compatibility.

### 8.3 Example
- Smoking: 1.0 × 0.25 = 0.25
- Schedule: 0.5 × 0.20 = 0.10
- Cleanliness: 1.0 × 0.20 = 0.20
- Noise: 0.8 × 0.15 = 0.12
- Guests: 0.5 × 0.10 = 0.05
- Pets: 1.0 × 0.10 = 0.10
- **Total = 82%** (illustrative only).

## 9. Database design [DESIGN]

### 9.1 Core tables

| Table | Key columns | Notes |
|---|---|---|
| `users` | id UUID PK, name, email UNIQUE, password_hash, email_verified_at, status, created_at | Store only hash, never plaintext |
| `user_roles` | user_id FK, role | Unique `(user_id, role)` |
| `student_verifications` | id, user_id FK, university_id FK, method, status, reviewed_by, reviewed_at | Proof stored securely, not public |
| `universities` | id, name, email_domains | Domains must be verified/configurable |
| `campuses` | id, university_id FK, name, latitude, longitude | Campus distance reference |
| `student_profiles` | user_id PK/FK, bio, budget_min, budget_max, move_in_date, discoverable | Private by default |
| `lifestyle_preferences` | user_id PK/FK, smoking, study_schedule, sleep_schedule, cleanliness, noise, guests, pets | Nullable preferences and weights |
| `listings` | id, owner_id FK, campus_id FK, title, description, rent, currency, deposit, lat, lng, status, available_from, last_confirmed_at | Never expose precise coordinates publicly |
| `listing_amenities` | listing_id FK, amenity_id FK | Many-to-many |
| `amenities` | id, name UNIQUE | Controlled values |
| `listing_photos` | id, listing_id FK, object_key, sort_order | Signed/private upload workflow |
| `favorites` | user_id FK, listing_id FK | Composite PK |
| `inquiries` | id, listing_id FK, sender_id FK, recipient_id FK, message, status | Listing contact |
| `connection_requests` | id, sender_id FK, recipient_id FK, status | Roommate consent |
| `reviews` | id, listing_id FK, landlord_id FK, author_id FK, rating, body, moderation_status, experience_proof_status | Ownership and moderation checks |
| `reports` | id, reporter_id FK, target_type, target_id, reason, status | Abuse handling |
| `notifications` | id, user_id FK, type, payload, read_at | No secrets in payload |
| `sessions` | id, user_id FK, token_hash, expires_at, revoked_at | Opaque session tokens |
| `password_reset_tokens` | id, user_id FK, token_hash, expires_at, used_at | Single-use |
| `audit_logs` | id, actor_id FK, action, target_type, target_id, created_at | Append-only policy |

### 9.2 Relationships
- `users 1:N listings`, `listings 1:N listing_photos`, `listings N:M amenities`.
- `users 1:1 student_profiles`, `users 1:1 lifestyle_preferences` for student accounts.
- `users N:M listings` through `favorites`.
- `listings 1:N inquiries` and `listings 1:N reviews`.
- `users 1:N reports`, `users 1:N audit_logs`.

### 9.3 Integrity and performance
- Foreign keys with intentional delete behavior; soft-delete public content requiring moderation history.
- Constraints: `rent >= 0`, `deposit >= 0`, `rating BETWEEN 1 AND 5`, `budget_min <= budget_max`.
- Indexes: `listings(status, campus_id, rent)`, `listings(available_from)`, `listings(owner_id)`, `reviews(listing_id, moderation_status)`.
- Case-insensitive unique email handling; avoid duplicate verified reviews by defining an experience identifier.
- Store monetary values as `DECIMAL(12,2)` and ISO currency codes (default MYR only if configured).
- Timezone-aware timestamps stored in UTC; format in user-local time in UI.
- Migration and rollback strategy documented; seed demo records must be clearly labeled fictitious.

## 10. REST API contract [DESIGN]

Use `{ "data": ..., "meta": ... }` on success and `{ "error": { "code": "...", "message": "..." } }` on failure. Server sets secure session cookie; never expose raw tokens in responses.

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| POST | `/api/v1/auth/register` | Register account | Public |
| POST | `/api/v1/auth/login` | Create session | Public |
| POST | `/api/v1/auth/logout` | Revoke session | Auth |
| GET | `/api/v1/auth/me` | Current user and roles | Auth |
| POST | `/api/v1/auth/verify-email` | Consume verification token | Public |
| POST | `/api/v1/auth/forgot-password` | Request reset | Public |
| POST | `/api/v1/auth/reset-password` | Reset password | Public |
| GET/PATCH | `/api/v1/profile` | Own profile | Auth |
| POST | `/api/v1/verifications` | Submit student proof | Student |
| GET | `/api/v1/listings` | Filtered listings | Public |
| GET | `/api/v1/listings/:id` | Published listing detail | Public |
| POST | `/api/v1/listings` | Create draft listing | Poster |
| PATCH/DELETE | `/api/v1/listings/:id` | Modify/soft-delete own listing | Owner/admin |
| POST | `/api/v1/listings/:id/submit` | Submit for approval | Owner |
| POST | `/api/v1/listings/:id/availability` | Reconfirm availability | Owner |
| POST | `/api/v1/uploads/sign` | Short-lived signed photo upload | Authorized poster |
| GET/POST/DELETE | `/api/v1/favorites` | Favorites management | Auth |
| GET/PATCH | `/api/v1/roommates/profile` | Own lifestyle profile | Student |
| GET | `/api/v1/roommates/matches` | Eligible ranked candidates | Verified student |
| POST | `/api/v1/roommates/requests` | Send connection request | Verified student |
| PATCH | `/api/v1/roommates/requests/:id` | Accept/decline request | Recipient |
| POST | `/api/v1/listings/:id/inquiries` | Contact owner | Auth |
| GET | `/api/v1/inquiries` | Own inquiries | Auth |
| GET | `/api/v1/listings/:id/reviews` | Approved reviews | Public |
| POST | `/api/v1/listings/:id/reviews` | Submit verified review | Verified eligible student |
| POST | `/api/v1/reports` | Report abuse | Auth |
| GET | `/api/v1/admin/overview` | Admin metrics | Admin |
| GET/PATCH | `/api/v1/admin/verifications/:id` | Verification moderation | Admin |
| GET/PATCH | `/api/v1/admin/listings/:id` | Listing moderation | Admin |
| GET/PATCH | `/api/v1/admin/reviews/:id` | Review moderation | Admin |
| GET/PATCH | `/api/v1/admin/reports/:id` | Report moderation | Admin |
| GET/POST/PATCH | `/api/v1/admin/campuses` | Campus management | Admin |

### 10.1 Example listing request

```json
{
  "title": "Single room near campus",
  "description": "Furnished room with Wi-Fi",
  "campusId": "<valid-campus-uuid>",
  "propertyType": "APARTMENT",
  "roomType": "SINGLE",
  "rent": "650.00",
  "currency": "MYR",
  "deposit": "650.00",
  "availableFrom": "2026-11-01",
  "amenityIds": ["<valid-amenity-uuid>"],
  "approximateArea": "Near campus"
}
```

All identifiers are placeholders. Precise location and images require separate authorized handling.

### 10.2 Search query example

`GET /api/v1/listings?campusId=<uuid>&minRent=300&maxRent=800&availableBy=2026-11-01&amenities=wifi,furnished&sort=rent_asc&page=1&limit=12`

Validate and whitelist filters and sort fields; use parameterized ORM queries.

## 11. Authentication, authorization and privacy [DESIGN]

- HTTPS only; `Secure`, `HttpOnly`, `SameSite=Lax` session cookies; use a deliberate same-site deployment setup or explicit cross-site cookie/CORS strategy.
- CSRF protection on cookie-authenticated state-changing requests (anti-CSRF token or validated Origin/Referer as appropriate).
- Hash passwords with Argon2id; minimum password length and compromised-password checks.
- Rotate session ID on login; expire inactive sessions; invalidate on password reset.
- Enforce least-privilege role-based and record-level authorization on every endpoint.
- Restrict CORS to known frontend origins; never use wildcard with credentials.
- Apply login, signup, inquiry and messaging rate limits; spam detection and abuse reporting.
- Protect against SQL injection via parameterized queries, XSS via escaping/sanitization, unsafe uploads via validation and storage isolation.
- Do not disclose private roommate data, proof documents or exact address to unauthorized users.
- Maintain clear consent, data retention/deletion, privacy policy and incident response procedures; assess applicability of Malaysia's PDPA and university rules with an appropriate reviewer.
- Backups encrypted, access restricted and restoration tested. Secrets only in provider secret managers/env vars, never Git.

## 12. Hosting and deployment [DESIGN]

### 12.1 Environments
- **Local:** Vite + Express + Docker PostgreSQL.
- **Staging:** isolated test database, object storage bucket and email sandbox.
- **Production:** HTTPS frontend, managed API, managed PostgreSQL, object storage and transactional email.

### 12.2 Example topology

```text
https://housing.example.com  -> frontend CDN (React static files)
https://api.housing.example.com -> Node/Express API service
                                    |-- managed PostgreSQL (private/TLS)
                                    |-- S3-compatible image bucket
                                    `-- email delivery service
GitHub -> CI tests -> staging -> approval -> production
```

`example.com` is a placeholder; no domain or hosting account is currently provisioned.

### 12.3 Environment variables (names only; never commit real values)

```dotenv
# apps/api/.env.example
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/student_housing
FRONTEND_ORIGIN=http://localhost:5173
SESSION_SECRET=replace-with-long-random-secret
COOKIE_DOMAIN=
EMAIL_FROM=no-reply@example.com
EMAIL_PROVIDER_API_KEY=
STORAGE_BUCKET=
STORAGE_REGION=
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
# apps/web/.env.example
VITE_API_BASE_URL=http://localhost:4000/api/v1
```

Placeholders are not production secrets. Use strong randomly generated secrets in deployment provider settings. Only `VITE_` variables are public browser configuration: **never put secrets there**.

### 12.4 Deployment checklist
1. Create GitHub repository; protect main branch; configure CI and secret scanning.
2. Provision production PostgreSQL; enforce TLS, access restrictions and automatic backups.
3. Provision image bucket with private-by-default access, limits and signed upload URLs.
4. Configure email provider and verify sender domain.
5. Deploy API; set environment secrets, health checks, logs, scaling and restart policy.
6. Run `prisma migrate deploy` as a controlled deployment step, with backup and rollback plan.
7. Deploy frontend with production API URL; configure SPA history fallback.
8. Attach custom domains and TLS certificates; configure CORS and cookie/CSRF behavior.
9. Create first admin through a restricted provisioning script, not public signup.
10. Run production smoke tests, upload checks, authorization tests and restore rehearsal.
11. Configure uptime alerts, error monitoring, cost limits and data-retention jobs.
12. Publish privacy/terms/contact pages and conduct a university/landlord policy review.

### 12.5 Example commands (after code is implemented)

```bash
corepack enable
pnpm install
# start local PostgreSQL from docker-compose.yml
docker compose up -d
pnpm --filter api prisma migrate dev
pnpm dev
pnpm lint
pnpm test
pnpm build
```

These are **target commands**, requiring corresponding scripts and files to be created. This document alone does not make them runnable.

## 13. Testing and quality assurance [DESIGN]

| Level | Tools (suggested) | Essential cases |
|---|---|---|
| Unit | Vitest | Matching score, validators, ownership helpers |
| API integration | Supertest + test PostgreSQL | Auth, CRUD, filtering, moderation, DB constraints |
| Frontend component | React Testing Library | Forms, filters, errors, accessibility |
| End-to-end | Playwright | Student, landlord, admin full flows |
| Security | Dependency audit + manual OWASP checks | CSRF, IDOR, XSS, brute force, file upload abuse |
| Performance | k6 (optional) | Search latency, pagination, image loading |
| Accessibility | axe + manual keyboard testing | Forms, dialogs, focus, contrast |
| Deployment | Smoke tests | Health checks, HTTPS, migrations, backups |

### 13.1 Acceptance test scenarios
1. Student registers; cannot review before verification; after approval, permitted features unlock.
2. Landlord creates listing; it is not public until admin approves it.
3. Student searches listings by maximum rent, available date and campus distance; results respect all filters.
4. Owner can edit own listing; another user receives 403/404 without information leakage.
5. Student opts into roommate matching; hard smoking incompatibility excludes candidates.
6. Matching score correctly ignores unanswered dimensions and never divides by zero.
7. Only eligible verified students can post reviews; pending reviews are hidden publicly.
8. Admin can reject abusive content with audit record.
9. Password reset tokens are single-use and expire.
10. Upload rejects oversized/disallowed files; images cannot be accessed through private storage paths without authorization.
11. Responsive mobile navigation and keyboard form submission work.
12. Deactivated profiles no longer appear in matching; account deletion/retention rules are honored.

### 13.2 Proposed measurable targets
- API p95 under 500 ms for common cached/normal searches under an agreed test load (target, not measured).
- No critical/high known security vulnerabilities at release.
- Core end-to-end acceptance tests passing in staging.
- Automated daily database backups with a documented restore test.
- WCAG 2.2 AA as target; document any known exceptions.

## 14. Development milestones and priorities

| Phase | Deliverables | Priority |
|---|---|---|
| 0. Planning | Wireframes, ERD, user stories, scope sign-off, threat model | Must |
| 1. Foundation | Monorepo, CI, DB schema, auth, roles, reusable UI | Must |
| 2. Listings | Landlord/student posting, photos, approval, search and filters | Must |
| 3. Matching | Lifestyle profiles, eligibility filters, scores, privacy | Must |
| 4. Reviews | Verification, ratings, moderation and abuse reports | Must |
| 5. Communication | Inquiry/connection requests, notifications | Must for proposed workflow |
| 6. Admin | Dashboard, verifications, reports, audit | Must |
| 7. Quality | Tests, security review, responsive polish, accessibility | Must |
| 8. Release | Staging, production hosting, backups, deployment docs | Must |
| 9. Enhancements | Maps, multilingual UI, advanced recommendations, chat | Optional |

**MVP boundary:** prioritize registration/verification, approved rental listings, filters, roommate profile/matching, moderated reviews and basic admin workflows. Advanced chat, booking, payment, AI matching and contracts are explicitly outside the initial scope unless separately approved.

## 15. User stories and definition of done

- **Student:** As a verified student, I can search approved rooms by rent, campus and availability so I can shortlist suitable accommodation.
- **Student:** As a student, I can set my lifestyle preferences and control discovery visibility so I can find roommates without oversharing personal data.
- **Landlord:** As a landlord, I can publish structured rental information after review so interested students can contact me.
- **Student reviewer:** As an eligible student, I can provide verified rental feedback so other students can make informed decisions.
- **Admin:** As an administrator, I can moderate verification, listings, reviews and reports so the platform remains trustworthy.

**Definition of done per feature:** validated UI; responsive states; authorized API; migration/DB constraints; tests for happy/negative paths; logging without private data; documentation; staging smoke test; reviewed accessibility and security impact.

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fraudulent or stale listings | Admin moderation, ownership checks, last-confirmed timestamps, reporting |
| Fake reviews | Student verification + experience proof + moderation + deduplication |
| Sensitive lifestyle data leakage | Opt-in discovery, field-level privacy, minimal retention, block/report |
| Poor matching recommendations | Transparent heuristic, hard constraints, user-controlled preferences, evaluation |
| Incorrect campus distance | Verified campus coordinates, approximate-distance label, optional map integration |
| Unauthorized actions | RBAC + ownership checks + security tests |
| Lost data | Managed backups, restore testing, migrations |
| Hosting costs | Usage quotas, storage limits, budget alerts, staged rollout |
| Scope creep | Milestone gates, MVP acceptance criteria, optional feature backlog |

## 17. FYP documentation and evaluation deliverables

- Problem statement and motivation linked to fragmented rental information and roommate lifestyle conflict.
- Objectives and measurable success criteria.
- Literature/competitor review (Telegram/email and Facebook Marketplace from TRF; add independently researched sources).
- Requirements specification (functional and non-functional).
- Use case diagram, system architecture diagram, ERD, UI wireframes and matching flowchart.
- Implementation chapters: frontend, backend, database, authentication and deployment.
- Testing chapter: test plan, test cases, screenshots, measured results and limitations.
- Evaluation: usability feedback from consenting students/landlords; precision and fairness review of matching heuristic.
- Deployment evidence: redacted screenshots of deployed site, health checks, CI status and database backup setup.
- User guide, admin guide, developer guide, README and presentation/demo script.

**Academic integrity:** Do not claim tests, interviews, live hosting, security certification or implementation work occurred until evidence exists. The originality report documents a similarity check, not a quality assessment of the proposed system.

## 18. Open decisions requiring supervisor/project-owner approval

1. Which university/universities and campuses are in initial scope? UTS-only or multi-university?
2. What qualifies as a verified student (institutional email, student card, manual approval)?
3. How will a rental experience be validated for student-only reviews without over-collecting personal documents?
4. Are student sublets allowed under relevant tenancy and university policies?
5. Which rental geography, currency and map provider will be used?
6. Is landlord identity verification required, and by whom?
7. Should users communicate through inquiries, in-app chat or external contact details?
8. What is the target budget, domain, deployment provider and data-retention period?
9. Are multilingual English/Malay/Chinese interfaces required? **Not specified in the uploaded TRF.**
10. Which specific features must be demonstrated for FYP assessment, and by what deadline?

## 19. Suggested build order for an AI coding assistant

> Implement the project described in `PROJECT_REQUIREMENTS.md` as a working React + TypeScript + Vite frontend and Node.js + TypeScript + Express backend with Prisma/PostgreSQL. Begin with monorepo scaffolding, Docker Compose for local PostgreSQL, environment examples, DB schema/migrations, auth/session/RBAC and a testable API. Implement listing CRUD, image upload, moderation and search next; then lifestyle profiles, explainable roommate matching, verified reviews, inquiries and admin screens. Use shared Zod validation, comprehensive error handling, responsive accessible UI and meaningful automated tests. Do not use mock data in production paths, do not hard-code secrets, and do not claim deployment until verified. Provide commands for setup, seed, tests, build and deployment. Complete one testable milestone at a time and document any unresolved requirements.

## 20. Completion tracker

- [ ] Supervisor approves open decisions and MVP scope
- [ ] Repository and CI configured
- [ ] Frontend screens implemented
- [ ] Backend endpoints implemented
- [ ] Database migrations and seed implemented
- [ ] Authentication, student verification and RBAC implemented
- [ ] Listings, search, photos and availability implemented
- [ ] Lifestyle matching implemented and tested
- [ ] Reviews and moderation implemented
- [ ] Inquiries, reports and notifications implemented
- [ ] Admin dashboard implemented
- [ ] Unit/integration/E2E tests passing
- [ ] Security/privacy/accessibility review completed
- [ ] Staging deployment verified
- [ ] Production hosting and HTTPS verified
- [ ] Backups, monitoring and incident procedures configured
- [ ] FYP report updated with genuine implementation evidence

---

*Prepared from the uploaded TRF and originality report. Source-backed requirements are distinguished from proposed implementation decisions. This Markdown file is a complete **development blueprint**, not a completed frontend/backend/hosting deployment.*
