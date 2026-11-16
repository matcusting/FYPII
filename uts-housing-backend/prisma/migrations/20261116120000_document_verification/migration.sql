-- Document-based verification: students (admin review), landlords and properties (legal reviewer)

ALTER TYPE "Role" ADD VALUE 'LEGAL_REVIEWER';
ALTER TYPE "VerificationMethod" ADD VALUE 'DOCUMENTS';

CREATE TYPE "DocumentKind" AS ENUM (
  'OFFER_LETTER', 'STUDENT_CARD', 'IDENTITY_CARD', 'COMPANY_REGISTRATION',
  'PROPERTY_TITLE', 'TENANCY_AGREEMENT', 'OWNER_AUTHORISATION', 'OTHER_PROPERTY'
);
CREATE TYPE "LegalStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "University" ADD COLUMN "requireStudentIdEmail" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Listing" ADD COLUMN "legalStatus" "LegalStatus" NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE "Listing" ADD COLUMN "legalNote" TEXT;
ALTER TABLE "Listing" ADD COLUMN "legalReviewedAt" TIMESTAMPTZ;
ALTER TABLE "Listing" ADD COLUMN "legalReviewedById" UUID;
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_legalReviewedById_fkey"
  FOREIGN KEY ("legalReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Listings that were already approved before this check existed keep their status.
UPDATE "Listing" SET "legalStatus" = 'APPROVED' WHERE "publishedAt" IS NOT NULL;

CREATE TABLE "Document" (
  "id" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "verificationId" UUID,
  "listingId" UUID,
  "kind" "DocumentKind" NOT NULL,
  "objectKey" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "supersededAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Document_size_check" CHECK ("sizeBytes" > 0),
  CONSTRAINT "Document_target_check" CHECK ("verificationId" IS NOT NULL OR "listingId" IS NOT NULL)
);
CREATE UNIQUE INDEX "Document_objectKey_key" ON "Document"("objectKey");
CREATE INDEX "Document_verificationId_idx" ON "Document"("verificationId");
CREATE INDEX "Document_listingId_idx" ON "Document"("listingId");
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
