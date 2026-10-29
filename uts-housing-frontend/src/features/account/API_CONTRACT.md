# Account screens: backend contracts

The account screens use the REST success envelope `{ "data": ... }` and the error envelope `{ "error": { "code": "...", "message": "..." } }`. Every mutation must check the session, CSRF token, ownership and rate limits server-side. The UI displays API errors; it does not simulate successful operations.

The project requirements define `GET/PATCH /api/v1/profile`, `POST /api/v1/verifications`, `GET /api/v1/inquiries` and `PATCH /api/v1/roommates/requests/:id`. The current backend also implements the read endpoints needed for request and review history. The account screens use these contracts:

| Method and path | Request body | Success `data` |
| --- | --- | --- |
| `GET /api/v1/profile` | — | Own account profile: `{displayName, email, phone, university, bio, preferredLocation, budgetMin, budgetMax, preferredMoveInDate, verificationStatus}`. `phone` is private. |
| `PATCH /api/v1/profile` | Student contact form sends `{displayName, phone, university, bio}`; landlord contact form sends `{displayName, phone}`. The university profile field does **not** establish student eligibility; verification derives the university from a configured email domain. Legacy optional profile fields remain accepted for compatibility. Cleared optional fields are `null`. | Updated own profile |
| `POST /api/v1/auth/register` | JSON `{name, email, password, role:"STUDENT", acceptTerms:true}`. Student email's exact domain must belong to an active campus; landlord registration is separate. | `{id,email,verificationRequired:true}` |
| `POST /api/v1/auth/verify-email` | JSON `{email,code}` from the emailed six-character code; existing 64-character links may still use `{token}` until expiry | `{verified:true}` |
| `POST /api/v1/verifications` | Multipart `method=DOCUMENTS`, `studentId` (JPG/PNG), `offerLetter` (PDF/JPG/PNG), optional `note` (up to 500 characters). Both files are mandatory and each is at most 5 MB. Requires verified school email and active campus domain; the server derives `university` from that domain. Legacy `EMAIL_DOMAIN` and `MANUAL` submissions are rejected. | `{id,method:"DOCUMENTS",status:"PENDING",createdAt}` |
| `GET /api/v1/admin/verifications/:id` | Admin session | Verification detail including `studentIdUrl` and `offerLetterUrl`; the queue does not include document URLs |
| `GET /api/v1/admin/verifications/:id/student-id` and `/offer-letter` | Admin session | Private document download with `no-store` caching |
| `PATCH /api/v1/admin/verifications/:id` | Admin JSON `{status:"APPROVED"|"REJECTED", reason}`; reason is required for rejection. Approval requires both stored documents and verified matching school email. | Reviewed verification record |
| `GET /api/v1/inquiries` | — | Array or `{items:[...]}` of own inquiries |
| `GET /api/v1/roommates/requests` | — | Array or `{requests:[...]}` of own sent and received requests, including `recipientId` or `direction` to distinguish incoming requests |
| `PATCH /api/v1/roommates/requests/:id` | JSON `{status:"ACCEPTED"}` or `{status:"DECLINED"}` | Updated request |
| `GET /api/v1/reviews/mine` | — | Array or `{reviews:[...]}` of own reviews, including moderation status |
| `GET /api/v1/admin/overview` | — | Optional numeric `pendingVerifications`, `pendingListings`, `pendingReviews`, `openReports` for dashboard counts |

The following account-management and optional-notification contracts are implemented beyond the requirements API table:

| Method and path | Request body | Success `data` |
| --- | --- | --- |
| `GET /api/v1/auth/sessions` | — | `{sessions:[{id,device,createdAt,lastActiveAt,current}]}`; only the signed-in user's sessions |
| `DELETE /api/v1/auth/sessions/:id` | — | `{revoked:true}`; only a session owned by the signed-in user |
| `POST /api/v1/account/deletion-requests` | JSON `{confirmation:"DELETE_ACCOUNT"}` | `{status:"PENDING", requestedAt}`; duplicate requests should be idempotent or return a clear error |
| `GET /api/v1/notifications/preferences` | — | `{emailInquiryUpdates:boolean,emailConnectionRequests:boolean,emailProductUpdates:boolean}` |
| `PATCH /api/v1/notifications/preferences` | JSON with any of those boolean fields | Updated preferences |

The API client expects a JSON envelope for responses with a body and also accepts `204 No Content` for successful empty responses. Session revocation and deletion requests must not use a client-supplied user ID. Security, verification and password reset messages are required and must remain outside the optional notification preferences. Student documents must be validated server-side and stored privately; the browser's 5 MB and MIME checks are only early feedback. Never put real documents or student identifiers in fixtures, the demo seed, or a preview package.
