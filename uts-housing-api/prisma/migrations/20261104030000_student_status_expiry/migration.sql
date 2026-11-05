ALTER TABLE "User" ADD COLUMN "studentVerifiedUntil" DATE;

-- Historical approvals remain usable only when an approved offer letter has a
-- recorded study-end date. A boolean alone cannot prove current enrollment.
UPDATE "User" AS account
SET "studentVerifiedUntil" = latest."studyEndsAt",
    "studentVerified" = (latest."studyEndsAt" >= ((now() AT TIME ZONE 'Asia/Kuching')::date))
FROM (
  SELECT DISTINCT ON ("userId") "userId", "studyEndsAt"
  FROM "StudentVerification"
  WHERE status = 'APPROVED' AND "studyEndsAt" IS NOT NULL
  ORDER BY "userId", "reviewedAt" DESC NULLS LAST, "createdAt" DESC, id DESC
) AS latest
WHERE account.id = latest."userId" AND account."studentVerified" = true;

UPDATE "User"
SET "studentVerified" = false,
    "verificationStatus" = 'UNVERIFIED'
WHERE "studentVerified" = true AND "studentVerifiedUntil" IS NULL;

CREATE INDEX "User_studentVerifiedUntil_idx" ON "User"("studentVerifiedUntil");
