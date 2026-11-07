-- =============================================================================
-- Aarohan: email login codes (AUTH_MODE=email) — ADDITIVE ONLY
-- =============================================================================

CREATE TABLE IF NOT EXISTS "EmailOtp" (
  "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "email"       TEXT         NOT NULL,
  "codeHash"    TEXT         NOT NULL,
  "attempts"    INTEGER      NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER      NOT NULL DEFAULT 5,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "isConsumed"  BOOLEAN      NOT NULL DEFAULT false,
  "ipAddress"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailOtp_email_key" ON "EmailOtp" ("email");

ALTER TABLE "EmailOtp" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "EmailOtp" FROM anon, authenticated;

-- One account per email address (case-insensitive). Skipped with a warning if old data already has duplicates.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "User" WHERE "email" IS NOT NULL GROUP BY lower("email") HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_key" ON "User" (lower("email")) WHERE "email" IS NOT NULL;
  ELSE
    RAISE WARNING 'Duplicate emails exist in "User": the unique email index was NOT created. Resolve the duplicates and create it manually.';
  END IF;
END $$;
