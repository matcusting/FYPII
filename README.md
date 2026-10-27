# UTS Housing & Roommate Finder

A local development build of the student housing project. The React website and Express/PostgreSQL API cover accounts, student and landlord verification, property authorization, moderated property listings, search and favorites, roommate matching, inquiries and consent-based messaging, rental-proof reviews, reports, notifications, and administration. The website keeps its existing visual style. English is the default interface language; users can switch to Bahasa Melayu or Simplified Chinese. The seeded accounts and property are fictional.

## Open locally on Windows

Install Node.js 24, Git and Docker Desktop. Open PowerShell, clone this branch, and enter the repository folder:

```powershell
git clone -b codex/frontend-preview https://github.com/matcusting/FYPII.git
cd FYPII
```

Start PostgreSQL and the API:

```powershell
docker compose up -d postgres
cd uts-housing-api
Copy-Item .env.example .env
npm ci
npm run db:generate
npm run db:deploy
$env:CONFIRM_DEMO_SEED='1'; npm run db:seed
npm run dev
```

Keep that window open. Open a second PowerShell window in `uts-housing-api` and start the email worker:

```powershell
npm run email:worker
```

Open a third PowerShell window in `uts-housing-frontend`:

```powershell
npm ci
npm run dev
```

Open **http://localhost:5173** in Chrome. The local demo accounts are `student@demo.local`, `candidate@demo.local`, `landlord@demo.local`, and `admin@demo.local`, with password `Demo12345!`. They exist only after the optional seed command. Never use fictional records to arrange a real rental. Stop the API, worker, and Vite with Ctrl+C; stop PostgreSQL with `docker compose down` when finished.

The application uses the real local API and database. The older `uts-housing-frontend/preview` server is a separate, temporary in-memory UI preview. Changes made in that preview disappear when it stops.

The language selector is available in the site navigation and role dashboards. It remembers the choice in this browser. Chat messages and user-entered listing text stay in their original language. If you switch accounts in another browser tab, the message composer resets its draft; reload any older tab before sending a reply. The API checks that the sender shown by the browser is still the signed-in account.

Student account settings collect a private phone number alongside the student's name, email, university and bio. The university shown in the profile does not determine verification: the API uses the verified school email's campus domain. Housing budget, preferred move-in date, and preferred area are edited in **My Lifestyle Profile** instead. The dashboard's **Find a Roommate** action opens that profile directly; university is never shown to roommate matches.

## Student verification

A new student account must use an email address whose **exact domain** appears on an active campus in the admin settings. The fictional UTS campus seed includes `student.uts.edu.my` for testing the domain rule. After registration, the student opens the verification link sent to that address, signs in, then submits **both** a student ID photo (JPG/PNG) and an offer letter (PDF/JPG/PNG) from Profile Settings. Each file may be up to 5 MB. An administrator reviews the two private files and approves or rejects the request; school-email ownership alone does not grant verified-student access. A rejected applicant can submit a new request.

The seeded `student@demo.local` and `candidate@demo.local` accounts are already marked verified for local feature testing; they do not test this new application flow. The local email worker writes links to `uts-housing-api/data/outbox` when SMTP is absent. Use fictional files for local tests, and never add real student IDs or offer letters to Git, the demo seed, or a preview ZIP. Production use needs working SMTP and private-file storage with suitable access controls and retention rules.

## Landlord verification and listing authorization

A landlord registers with a name, personal or business email, phone number, and password, then verifies ownership of that email through the emailed link. Providing a phone number does not mean the number has been verified by SMS. The landlord can prepare draft listings while verification is pending.

Before a landlord listing can be published, an administrator must review two separate applications: the landlord's identity (individual identity document, or company registration and representative authority documents) and evidence of the right to rent out **that specific property**. A property owner, agent, or subletter chooses the corresponding authorization path and supplies the required proof. Verified students who sublet must also submit property authorization. Property authorization is tied to the listing and its complete address; changing the address or authorization evidence requires another review. The admin also reviews the listing content and photos before publication. An email-verified account or approved identity alone does not grant publication rights.

Applying the new database migration pauses previously published listings because they have not passed these new checks. Their owners must submit evidence and ask for a fresh listing review. The fictional sample listing created by the local seed has its own explicit synthetic review records so the demonstration remains browsable.

Identity and authorization documents are submitted privately by applicants and can be downloaded only by authorized administrators; applicants can see their review status and reason. The documents are never shown in public listings. A review badge means an administrator assessed submitted evidence; it is not a guarantee that a property or document is authentic. Use only fictional documents in local tests and the preview. Before processing real identity documents, set up secure private storage, SMTP, access and retention policies, and a process for disputed or revoked authorization. No environment is deployed by these repository changes.

## Property addresses and location privacy

Listing owners enter a full street address when creating or editing a property. They choose whether an approved listing shares that address with signed-in students; the owner and administrators can always view it. Other visitors see only the approximate area. The site has no embedded map, coordinate entry or distance sorting. Existing legacy coordinates are not returned in listing responses, and address-only listings cannot be ranked by campus distance without a future geocoding service.

## Checks and project files

Run `npm run typecheck`, `npm test`, and `npm run build` in both `uts-housing-api` and `uts-housing-frontend`. Run `npm run lint` in the frontend. API integration tests can use a migrated disposable PostgreSQL database via `TEST_DATABASE_URL`. CI performs these checks and applies the committed SQL migration to its test database.

The [API guide](uts-housing-api/README.md) explains migration, seed, and email behavior. [Frontend guide](uts-housing-frontend/README.md) describes its routes. The user's uploaded `PROJECT_REQUIREMENTS.md` is the product blueprint; its checklist was not evidence of completed work. Deployment, provider SMTP, backups, and production monitoring still require environment-specific setup and review.
