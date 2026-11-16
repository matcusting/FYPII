-- FYP II: stale-listing reminders and notification preferences

ALTER TABLE "Listing" ADD COLUMN "staleReminderAt" TIMESTAMPTZ;
CREATE INDEX "Listing_status_lastConfirmedAt_idx" ON "Listing"("status", "lastConfirmedAt");

ALTER TABLE "User" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
