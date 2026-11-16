# REST API reference (`/api/v1`)

Responses: `{ "data": ..., "meta": ... }` on success, `{ "error": { "code", "message", "fields" } }` on failure.
Authentication uses the HTTP-only `uts_sid` session cookie. Health checks: `GET /health/live`, `GET /health/ready`.

| Method | Path | Who |
|---|---|---|
| POST | `/auth/register` · `/auth/login` · `/auth/logout` · `/auth/logout-all` | Public / Auth |
| GET | `/auth/me` | Auth |
| POST | `/auth/verify-email` · `/auth/resend-verification` | Public / Auth |
| POST | `/auth/forgot-password` · `/auth/reset-password` · `/auth/change-password` · `/auth/delete-account` | Public / Auth |
| GET, PATCH | `/profile` (includes `emailNotifications: boolean`) | Auth |
| GET, POST | `/profile/verification` | Student, Landlord |
| GET | `/meta` (facilities, room types, campuses, habit options, report reasons) | Public |
| GET | `/listings` (`q, minRent, maxRent, maxDeposit, maxDistance, roomType, amenities, furnished, availableBy, saved, sort, page, limit`) | Public |
| GET | `/listings/mine` · `/listings/:id` | Owner / Public (published only) |
| POST | `/listings` · `/listings/:id/submit` · `/listings/:id/status` · `/listings/:id/availability` | Owner |
| PATCH, DELETE | `/listings/:id` | Owner, Admin |
| POST, DELETE | `/listings/:id/photos` (multipart `photos`) · `/listings/:id/photos/:photoId` | Owner |
| POST | `/listings/:id/inquiries` | Auth |
| GET, POST | `/listings/:id/reviews` | Public / Verified student |
| GET | `/favorites` · POST/DELETE `/favorites/:listingId` | Auth |
| GET, PUT | `/roommates/profile` | Student |
| GET | `/roommates/matches` | Verified student |
| GET, POST | `/roommates/requests` · PATCH/DELETE `/roommates/requests/:id` | Student |
| GET | `/conversations` · `/conversations/:id/messages` | Participant |
| POST | `/conversations/:id/messages` · `/conversations/support` | Participant / Auth |
| GET | `/blocks` · POST/DELETE `/blocks/:userId` | Auth |
| GET | `/reviews/mine` · `/reviews/landlord` | Student / Landlord |
| PATCH, DELETE | `/reviews/:id` · POST `/reviews/:id/reply` | Author / Landlord |
| POST | `/reports` · GET `/reports/mine` | Auth |
| GET | `/notifications` · POST `/notifications/:id/read` · `/notifications/read-all` | Auth |
| GET | `/admin/overview` · `/admin/audit-logs` | Admin |
| GET, PATCH | `/admin/verifications[/:id]` · `/admin/listings[/:id]` · `/admin/reviews[/:id]` · `/admin/reports[/:id]` | Admin |
| GET, PATCH, DELETE | `/admin/users[/:id]` | Admin |
| GET, POST, PATCH | `/admin/universities[/:id]` · `/admin/campuses[/:id]` · POST `/admin/amenities` | Admin |

## Real-time events (Socket.IO, same origin as the API)

The browser connects with its normal `uts_sid` cookie. Only the configured `FRONTEND_ORIGIN` may connect. Sockets are disconnected on logout, logout-all, password reset, account deletion and suspension.

| Direction | Event | Payload |
|---|---|---|
| server → client | `message:new` | `{ conversationId, message: { id, body, createdAt, mine, senderName } }` (sent to every participant) |
| server → client | `notification:new` | `{ id, type, title, body, link, readAt, createdAt }` |
| server → client | `typing` | `{ conversationId, name }` |
| client → server | `typing` | `{ conversationId }` (ignored unless the sender is a participant) |

Messages are still sent with `POST /conversations/:id/messages` (validated and rate-limited); the socket only delivers them.

## Background job

Every `JOB_INTERVAL_MINUTES` (default 60) the API checks published listings: after `STALE_LISTING_DAYS` (30) without confirmation the owner is reminded; after `AUTO_PAUSE_LISTING_DAYS` (45) the listing is paused automatically. `POST /listings/:id/availability` on an auto-paused listing publishes it again without another review.
