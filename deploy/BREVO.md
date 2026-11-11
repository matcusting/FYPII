# Brevo email setup (not deployed)

Brevo is the selected provider for verification codes, password resets, account invitations and notifications. The existing email worker uses SMTP with STARTTLS on port 587; it does not need Brevo's REST API. Brevo does **not** provide the address lookup used to calculate distance to campus. That remains a separate `GEOCODER_URL` decision.

## Set up the sender in Brevo

1. Create or activate a Brevo account with transactional email enabled. In its sender/domain settings, verify an address or a domain that you control. A domain you control with the DNS records Brevo requests is preferable for reliable delivery. Use only a sender Brevo accepts; the site's public support Gmail address is **not automatically** an authorized sender. Do not send from a UTS domain unless the university has authorized you to control it.
2. In Brevo's SMTP settings, find the **SMTP login** shown for your account and generate an **SMTP key**. The SMTP key is different from a Brevo REST API key and from your Brevo account password. Keep it in your local `.env` or Render's secret settings; never paste it into chat, screenshots, source files or Git.
3. Choose an `EMAIL_FROM` using the verified address, for example `Housing Support <mail@your-own-domain.example>`. Replace the example address with your real verified sender.

## Test locally before deployment

In your private `uts-housing-api/.env` file, set these values using the login and key from your own Brevo dashboard:

```dotenv
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<Brevo SMTP login>
SMTP_PASSWORD=<Brevo SMTP key>
EMAIL_FROM=Housing Support <verified-sender@your-own-domain.example>
```

The angle-bracket values above are **placeholders**, not usable credentials. Never commit `.env`. Restart both the API and the email worker after editing it. From `uts-housing-api`, run `npm run email:check -- --to=your-own-address@example.com` using an inbox you control. This checks the SMTP connection and sends a harmless message; confirm that the message actually arrives in the inbox or spam folder. SMTP acceptance alone does not prove delivery. Then request a fresh verification code using your own test account, and inspect Brevo's transactional email activity and `/admin/email-delivery` if it does not arrive. While Brevo is unconfigured, leave `SMTP_HOST` blank so the local-only outbox remains available.

## Render settings when you later deploy

The [Render Blueprint](../render.yaml) already sets `SMTP_HOST=smtp-relay.brevo.com` and `SMTP_PORT=587` on **both** the web service and the email worker. Enter identical `SMTP_USER`, `SMTP_PASSWORD` and `EMAIL_FROM` values in both services' private environment settings. The worker also needs its `PUBLIC_BASE_URL` set to the website's exact HTTPS origin for links. Do not store the SMTP key in a `VITE_` variable or a repository file. Production startup requires these values and does not fall back to a local outbox. After deployment, repeat the harmless mail check and confirm inbox delivery before inviting the administrator or legal reviewer.

Email delivery is only one launch dependency. A production property-address lookup service must separately supply a compatible HTTPS `GEOCODER_URL`; see the [Render guide](RENDER.md). No Render service is created by these configuration files.
