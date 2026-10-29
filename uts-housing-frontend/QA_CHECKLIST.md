# Local browser and accessibility checks

Use fictional seed accounts and a disposable local database. Do not upload real student IDs, offer letters, identity cards, or tenancy documents while testing.

The automated browser smoke test needs the frontend, API, and database running on the same computer. After the optional fictional seed, run from `uts-housing-frontend`:

```bash
npm run test:browser
```

It launches an installed Chrome/Chromium directly, so it does not download a browser or require an extra npm package. On Windows, set `CHROME_BIN` to the full Chrome executable path if Chrome is not in its standard installation folder. `SMOKE_BASE_URL` defaults to `http://127.0.0.1:5173/`; `SMOKE_ADMIN_EMAIL` and `SMOKE_ADMIN_PASSWORD` default to the fictional admin account. The script accepts only a localhost URL, uses a temporary browser profile, and checks English/Malay/Chinese text, admin sign-in and review navigation, a narrow mobile viewport, and the skip link. It does not replace manual accessibility testing. To smoke-test the separate local preview, set `SMOKE_BASE_URL` to `http://127.0.0.1:4173/` while the preview is running.

Before release, record the browser and device used and check these flows manually:

1. At 375 px mobile width, tablet width, and desktop width, navigate every public, student, landlord, and admin page. Check for clipped text, horizontal page scrolling, inaccessible tables, and hidden action buttons.
2. Starting at the browser address bar, use only Tab, Shift+Tab, Enter, Space, and arrow keys to register, sign in, search, complete profile forms, upload test documents, review an application, and send a message. Check that focus remains visible, the skip link reaches the main content, and every action is reachable.
3. Use a screen reader to confirm that form fields, required values, errors, status messages, language selection, message sender and date, and moderation decisions are announced clearly. Verify that confirmation and rejection reasons remain understandable without color.
4. Switch among English, Bahasa Melayu, and Simplified Chinese on both desktop and mobile. Confirm translated labels fit, dates remain readable, and user-written messages/listing text are not altered.
5. With separate browser profiles, run the student and landlord registration, email verification, document review, property authorization, listing moderation, inquiry, and roommate connection flows against the real API. Confirm a non-admin cannot open private proofs and that an unapproved listing is not public.
6. With fictional property addresses, save listings near and far from a campus and verify the displayed straight-line distances, maximum-distance filter, and nearest-first sort. Change the campus coordinates as an administrator and confirm the distances update. Check that an unmatched address shows no invented distance and that public API responses never contain the exact address or coordinates unless sharing rules permit the address. Verify the landlord's aggregate rating includes only approved reviews of public properties, and that availability changes appear after refresh or within one minute while the owner-reported warning remains visible.
7. In the target production environment, check HTTPS, cookie behavior, real email delivery, address-provider access, backup restoration, account deletion, and a failed upload/retry before accepting real data. Record any known WCAG 2.2 AA exceptions and remediation.

The Windows preview is an in-memory demonstration. Use the real frontend/API/PostgreSQL stack for final feature and privacy acceptance.
