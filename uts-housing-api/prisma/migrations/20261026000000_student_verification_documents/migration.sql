ALTER TYPE "VerificationMethod" ADD VALUE IF NOT EXISTS 'DOCUMENTS';

ALTER TABLE "StudentVerification"
  ADD COLUMN "studentIdKey" TEXT,
  ADD COLUMN "offerLetterKey" TEXT;
