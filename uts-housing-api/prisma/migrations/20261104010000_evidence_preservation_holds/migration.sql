ALTER TABLE "StudentVerification"
  ADD COLUMN "evidenceHoldAt" TIMESTAMP(3),
  ADD COLUMN "evidenceHoldReason" TEXT;

ALTER TABLE "LandlordVerification"
  ADD COLUMN "evidenceHoldAt" TIMESTAMP(3),
  ADD COLUMN "evidenceHoldReason" TEXT;

ALTER TABLE "PropertyAuthorization"
  ADD COLUMN "evidenceHoldAt" TIMESTAMP(3),
  ADD COLUMN "evidenceHoldReason" TEXT;

ALTER TABLE "StudentVerification" ADD CONSTRAINT "StudentVerification_evidence_hold_pair"
  CHECK (("evidenceHoldAt" IS NULL) = ("evidenceHoldReason" IS NULL));
ALTER TABLE "LandlordVerification" ADD CONSTRAINT "LandlordVerification_evidence_hold_pair"
  CHECK (("evidenceHoldAt" IS NULL) = ("evidenceHoldReason" IS NULL));
ALTER TABLE "PropertyAuthorization" ADD CONSTRAINT "PropertyAuthorization_evidence_hold_pair"
  CHECK (("evidenceHoldAt" IS NULL) = ("evidenceHoldReason" IS NULL));
