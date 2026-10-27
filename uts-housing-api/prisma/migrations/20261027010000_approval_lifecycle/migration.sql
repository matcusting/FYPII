ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'REVOKED';

ALTER TABLE "LandlordVerification"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

ALTER TABLE "PropertyAuthorization"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

-- Existing approvals did not carry reviewed document expiry dates. Treat them
-- as expired now rather than silently granting an unreviewed extension.
UPDATE "LandlordVerification"
SET "expiresAt" = CURRENT_TIMESTAMP
WHERE "status" = 'APPROVED' AND "expiresAt" IS NULL;

UPDATE "PropertyAuthorization"
SET "expiresAt" = CURRENT_TIMESTAMP
WHERE "status" = 'APPROVED' AND "expiresAt" IS NULL;

CREATE INDEX "LandlordVerification_status_expiresAt_idx"
  ON "LandlordVerification"("status", "expiresAt");
CREATE INDEX "PropertyAuthorization_status_expiresAt_idx"
  ON "PropertyAuthorization"("status", "expiresAt");
