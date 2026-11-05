# Production administrator and legal-reviewer invitations

Production must not run `db:init-local`, `db:seed`, or `lawyer:provision`. They are local-test commands. Use `account:invite` only after production migrations, real SMTP delivery, a verified sender address, an HTTPS `PUBLIC_BASE_URL`, and a unique `SESSION_SECRET` are configured. The command **queues** an invitation for the email worker; it does not prove delivery or send from the CLI. No password or invitation token is printed.

For a **new production database with no administrator role**, the operator runs from `uts-housing-api` in a protected server shell:

```sh
npm run account:invite -- --role=ADMIN --name="Operator legal name" --email="operator@your-domain.example"
```

This creates exactly one suspended administrator account with an unknown random password. It refuses to bootstrap another administrator when any admin account already exists. Check the mail worker and inbox without copying the private link into chat, screenshots, logs, or tickets. The recipient opens the HTTPS `/accept-invite` link within 24 hours and sets a password of at least 12 characters. Only then does the account become active and its mailbox count as verified. A used or expired link cannot activate the account. If it expired before acceptance, run the same command with `--resend`; this invalidates old links and clears undelivered old invitation payloads. Keep `SESSION_SECRET` stable between issuing and accepting links.

On first password sign-in, a privileged account receives a limited session. It must enroll an authenticator app in the account's MFA setup screen and confirm a six-digit time-based code before the administrator or legal-reviewer pages can be opened. The eight one-time recovery codes are displayed once: save them privately outside the site's database and never email or screenshot them. Later sign-ins require a current authenticator code or an unused recovery code. The production `MFA_ENCRYPTION_KEY` must be a unique 32-byte hex key, stored in the deployment secret manager and retained through restarts; losing it makes existing authenticator secrets unusable.

If an administrator or reviewer loses the authenticator **and** all recovery codes, independently verify their identity through the written operating arrangement and use a protected server shell. The command requires an active email-verified administrator as authorizer, an out-of-band identity-check acknowledgement, a private reason and an exact confirmation phrase:

```sh
npm run account:mfa-recover -- --target-email="reviewer@law-firm.example" --actor-email="operator@your-domain.example" --reason="Confirmed with reviewer by established callback" --out-of-band-identity-confirmed --confirm=RESET_PRIVILEGED_MFA
```

If the **only** administrator loses access, use their same email for both addresses and add `--sole-admin-recovery`; the command refuses that flag when another active administrator exists. Server-shell access is the emergency authority in this case: restrict and audit it separately. Recovery revokes every session and old token, replaces the password with an unknown random value, clears MFA, and queues a one-hour password reset link to the account's existing verified mailbox. Nothing sensitive is printed. After resetting the password, the user must enroll MFA before entering privileged pages. If SMTP is unavailable or the reset link expires, request a fresh ordinary password reset after delivery works; the account remains inaccessible meanwhile. Do not run this merely on an unverified email request.

For the law firm, independently confirm its designated reviewer and their work mailbox through the firm's established channels and the written engagement. Do not infer an address from a business card. A verified active administrator then authorizes a **dedicated lawyer-only** invitation:

```sh
npm run account:invite -- --role=LAWYER --name="Designated Reviewer" --email="reviewer@law-firm.example" --actor-email="operator@your-domain.example"
```

The reviewer sets their own password from the one-time link, signs in through **Legal Reviewer**, and sees only cases assigned by the administrator. `--resend` works only for the same suspended, unaccepted invitation. Neither command upgrades an existing public account or changes an active user's password. The administrator should confirm the account is active, assign a fictional case first, and later suspend the reviewer and revoke sessions when the engagement ends. Real documents must not be sent to the law firm until its secure access and privacy arrangements have been agreed.

The CLI performs database changes and queues mail; it does not create a hosting account, SMTP provider, domain, or law-firm engagement. The one-time link remains in the restricted email-job payload until delivered or expired; the worker clears successful and exhausted payloads. Protect the database and its backups accordingly. Do not use a publicly documented demo password or copy a local test database into production.
