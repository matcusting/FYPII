ALTER TABLE "User"
  ADD COLUMN "mfaSecretEncrypted" TEXT,
  ADD COLUMN "mfaPendingEncrypted" TEXT,
  ADD COLUMN "mfaPendingCreatedAt" TIMESTAMP(3),
  ADD COLUMN "mfaRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mfaLastUsedStep" INTEGER,
  ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

ALTER TABLE "Session" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
