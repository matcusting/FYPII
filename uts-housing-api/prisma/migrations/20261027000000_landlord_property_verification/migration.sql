CREATE TYPE "LandlordKind" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "PropertyAuthorityKind" AS ENUM ('OWNER', 'AGENT', 'SUBLETTING');

CREATE TABLE "LandlordVerification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "LandlordKind" NOT NULL,
  "identityKey" TEXT,
  "companyKey" TEXT,
  "representationKey" TEXT,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LandlordVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PropertyAuthorization" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  "kind" "PropertyAuthorityKind" NOT NULL,
  "proofKey" TEXT,
  "supportingKey" TEXT,
  "addressSnapshot" TEXT NOT NULL,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PropertyAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LandlordVerification_status_createdAt_idx" ON "LandlordVerification"("status", "createdAt");
CREATE INDEX "LandlordVerification_userId_createdAt_idx" ON "LandlordVerification"("userId", "createdAt");
CREATE INDEX "PropertyAuthorization_status_createdAt_idx" ON "PropertyAuthorization"("status", "createdAt");
CREATE INDEX "PropertyAuthorization_listingId_createdAt_idx" ON "PropertyAuthorization"("listingId", "createdAt");
CREATE INDEX "PropertyAuthorization_requesterId_createdAt_idx" ON "PropertyAuthorization"("requesterId", "createdAt");

ALTER TABLE "LandlordVerification" ADD CONSTRAINT "LandlordVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PropertyAuthorization" ADD CONSTRAINT "PropertyAuthorization_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PropertyAuthorization" ADD CONSTRAINT "PropertyAuthorization_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing listings have never passed the new identity and rental-authority checks.
-- Pause them until their owner submits evidence and an administrator reviews it.
UPDATE "Listing" SET "status" = 'PAUSED', "reviewedAt" = NULL,
  "moderationReason" = 'Identity and property authority review required.'
WHERE "status" = 'PUBLISHED';
