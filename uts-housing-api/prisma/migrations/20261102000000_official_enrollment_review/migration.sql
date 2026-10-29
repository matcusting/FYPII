ALTER TABLE "StudentVerification"
  ADD COLUMN "enrollmentCheckStatus" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
  ADD COLUMN "enrollmentCheckReference" TEXT,
  ADD COLUMN "enrollmentCheckedAt" TIMESTAMP(3);

ALTER TABLE "StudentVerification"
  ADD CONSTRAINT "StudentVerification_enrollmentCheckStatus_check"
  CHECK ("enrollmentCheckStatus" IN ('NOT_CHECKED', 'ACTIVE', 'INACTIVE', 'INCONCLUSIVE'));
