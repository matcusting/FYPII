# Phone verification on the local site

Students and landlords can save a phone number in **Profile Settings**, then use **Phone Verification** to request and enter a six-digit code. Email verification is required before requesting a code. The code expires after 10 minutes, can be requested again after 10 minutes, and is invalid after five wrong attempts. Changing the saved number clears its verification state and any pending code. SMS codes are stored only as keyed hashes in PostgreSQL; codes are never returned by the API.

By default, `.env.example` uses `SMS_PROVIDER=localOutbox`. The API writes the test SMS to `uts-housing-api/data/sms-outbox` with private file permissions. Nothing is sent to a real phone. Entering that code completes a **local workflow test only**; it does **not** set `phoneVerifiedAt` or establish ownership. The profile screen labels this state accordingly. This folder is ignored by Git and should be kept private.

To send real messages while the website still runs locally, obtain a Twilio account with an SMS-enabled sender number, then set these in the private `uts-housing-api/.env`:

```text
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...your account SID...
TWILIO_AUTH_TOKEN=...your private auth token...
TWILIO_FROM=+60...your approved sender number...
```

Restart the **API** window. Sign in to a test account whose email has been verified, save a phone number in international format (for example `+60123456789`), request a code and confirm receipt on that phone. The API sends an HTTPS request to Twilio. An accepted API request does not prove handset delivery; successful code entry marks the saved number verified. Twilio trial accounts may only send to numbers you have verified with Twilio, and delivery depends on the account, sender and destination. Keep the auth token out of Git and screenshots. The phone number and code are sent to Twilio as part of delivery.

Set `SMS_PROVIDER=disabled` to hide the send action when no SMS workflow is wanted. In production, the default is disabled; `localOutbox` is rejected. SMS verification remains optional and is not used to approve student status or landlord identity. Those still require their respective email/document and administrator review steps.
