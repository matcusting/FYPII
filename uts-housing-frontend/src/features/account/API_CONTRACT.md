# Account screens: backend contracts

The account screens use the REST success envelope `{ "data": ... }` and the error envelope `{ "error": { "code": "...", "message": "..." } }`. Every mutation must check the session, CSRF token, ownership and rate limits server-side. The UI displays API errors; it does not simulate successful operations.

The project requirements define `GET/PATCH /api/v1/profile`, `POST /api/v1/verifications`, `GET /api/v1/inquiries` and `PATCH /api/v1/roommates/requests/:id`. The screen plan also requires request and review history, but its API table omits their read endpoints. The following request and response shapes are the frontend assumptions to confirm while implementing the backend:

| Method and path | Request body | Success `data` |
| --- | --- | --- |
| `GET /api/v1/profile` | — | Own account profile: `{displayName, email, phone, university, bio, preferredLocation, budgetMin, budgetMax, preferredMoveInDate, verificationStatus}`. `phone` is private. |
| `PATCH /api/v1/profile` | Student and landlord contact form sends `{displayName, phone}`. Student verification may additionally update `university`; legacy optional fields remain accepted for compatibility. Cleared optional fields are `null`. | Updated own profile |
| `POST /api/v1/verifications` | For university email: JSON `{method:"EMAIL_DOMAIN", university}`. For manual review: multipart fields `method=MANUAL`, `university`, `proof` (PDF/JPG/PNG), optional `note` | Submitted verification record |
| `GET /api/v1/inquiries` | — | Array or `{items:[...]}` of own inquiries |
| `GET /api/v1/roommates/requests` | — | Array or `{requests:[...]}` of own sent and received requests, including `recipientId` or `direction` to distinguish incoming requests |
| `PATCH /api/v1/roommates/requests/:id` | JSON `{status:"ACCEPTED"}` or `{status:"DECLINED"}` | Updated request |
| `GET /api/v1/reviews/mine` | — | Array or `{reviews:[...]}` of own reviews, including moderation status |
| `GET /api/v1/admin/overview` | — | Optional numeric `pendingVerifications`, `pendingListings`, `pendingReviews`, `openReports` for dashboard counts |

The following contracts are **proposed additions** for account management and optional notification settings. They are not defined in the requirements API table and need backend implementation:

| Method and path | Request body | Success `data` |
| --- | --- | --- |
| `GET /api/v1/auth/sessions` | — | `{sessions:[{id,device,createdAt,lastActiveAt,current}]}`; only the signed-in user's sessions |
| `DELETE /api/v1/auth/sessions/:id` | — | `{revoked:true}`; only a session owned by the signed-in user |
| `POST /api/v1/account/deletion-requests` | JSON `{confirmation:"DELETE_ACCOUNT"}` | `{status:"PENDING", requestedAt}`; duplicate requests should be idempotent or return a clear error |
| `GET /api/v1/notifications/preferences` | — | `{emailInquiryUpdates:boolean,emailConnectionRequests:boolean,emailProductUpdates:boolean}` |
| `PATCH /api/v1/notifications/preferences` | JSON with any of those boolean fields | Updated preferences |

The API client expects a JSON envelope for responses with a body and also accepts `204 No Content` for successful empty responses. Session revocation and deletion requests must not use a client-supplied user ID. Security, verification and password reset messages are required and must remain outside the optional notification preferences. Manual proof files must be validated server-side and stored privately; the browser's 5 MB and MIME checks are only early feedback.
