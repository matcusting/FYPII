ALTER TABLE "StudentVerification"
  ADD COLUMN "studyEndsAt" DATE,
  ADD COLUMN "evidenceRetainUntil" DATE;

CREATE INDEX "StudentVerification_status_evidenceRetainUntil_idx"
  ON "StudentVerification"("status", "evidenceRetainUntil");
