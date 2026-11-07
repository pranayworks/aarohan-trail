-- =============================================================================
-- Aarohan SMS Gateway Providers, Logging & Delivery Auditing — ADDITIVE ONLY Migration
-- Lilongwe, Malawi • Applied to DEV database only
-- NEVER drops, renames or alters existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. NEW ENUMS (ADDITIVE ONLY)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "SmsPurpose" AS ENUM ('OTP', 'PARCEL_CODE', 'SOS', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SMS_CAP_EXCEEDED';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SMS_TEST_SENT';
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. NEW TABLE: SmsLog (Zero message body, zero OTP codes)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SmsLog" (
  "id"                TEXT          NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "phoneHash"         TEXT          NOT NULL,
  "phoneMasked"       TEXT          NOT NULL,
  "provider"          TEXT          NOT NULL,
  "purpose"           "SmsPurpose"  NOT NULL DEFAULT 'OTP',
  "status"            "SmsStatus"   NOT NULL DEFAULT 'QUEUED',
  "providerMessageId" TEXT,
  "errorCode"         TEXT,
  "createdAt"         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. INDEXES
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "SmsLog_phoneHash_createdAt_idx"
  ON "SmsLog" ("phoneHash", "createdAt");

CREATE INDEX IF NOT EXISTS "SmsLog_status_createdAt_idx"
  ON "SmsLog" ("status", "createdAt");

CREATE INDEX IF NOT EXISTS "SmsLog_provider_createdAt_idx"
  ON "SmsLog" ("provider", "createdAt");

CREATE INDEX IF NOT EXISTS "SmsLog_providerMessageId_idx"
  ON "SmsLog" ("providerMessageId");

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) & RESTRICTED ACCESS
-- ---------------------------------------------------------------------------

ALTER TABLE "SmsLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SmsLog" FROM anon, authenticated;

DO $$ BEGIN
  CREATE POLICY "SmsLog_service_role_only" ON "SmsLog"
    USING (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

