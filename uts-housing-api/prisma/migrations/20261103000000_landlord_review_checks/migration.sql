ALTER TABLE "LandlordVerification"
  ADD COLUMN "reviewerSourceReference" TEXT,
  ADD COLUMN "identityMatched" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "companyRegistryChecked" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "PropertyAuthorization"
  ADD COLUMN "reviewerSourceReference" TEXT,
  ADD COLUMN "authorityChecked" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "addressMatched" BOOLEAN NOT NULL DEFAULT FALSE;
