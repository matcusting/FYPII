ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'LAWYER';

ALTER TABLE "LandlordVerification"
  ADD COLUMN "lawyerId" TEXT,
  ADD COLUMN "lawyerAssignedAt" TIMESTAMP(3),
  ADD COLUMN "lawyerDecision" TEXT,
  ADD COLUMN "lawyerReason" TEXT,
  ADD COLUMN "lawyerSourceReference" TEXT,
  ADD COLUMN "lawyerIdentityMatched" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "lawyerCompanyRegistryChecked" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "lawyerReviewedAt" TIMESTAMP(3);

ALTER TABLE "PropertyAuthorization"
  ADD COLUMN "lawyerId" TEXT,
  ADD COLUMN "lawyerAssignedAt" TIMESTAMP(3),
  ADD COLUMN "lawyerDecision" TEXT,
  ADD COLUMN "lawyerReason" TEXT,
  ADD COLUMN "lawyerSourceReference" TEXT,
  ADD COLUMN "lawyerAuthorityChecked" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "lawyerAddressMatched" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "lawyerReviewedAt" TIMESTAMP(3);

ALTER TABLE "LandlordVerification"
  ADD CONSTRAINT "LandlordVerification_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PropertyAuthorization"
  ADD CONSTRAINT "PropertyAuthorization_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "LandlordVerification_lawyerId_status_createdAt_idx" ON "LandlordVerification"("lawyerId", "status", "createdAt");
CREATE INDEX "PropertyAuthorization_lawyerId_status_createdAt_idx" ON "PropertyAuthorization"("lawyerId", "status", "createdAt");
