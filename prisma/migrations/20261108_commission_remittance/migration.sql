-- =============================================================================
-- Aarohan: CommissionRemittance (driver cash-commission payments) — ADDITIVE ONLY
-- Moves the settlement queue out of a JSON file and into PostgreSQL.
-- Never drops, renames or alters existing data.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE "RemittanceStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_DOCUMENTS_VIEWED';
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CommissionRemittance" (
  "id"          TEXT               NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "driverId"    TEXT               NOT NULL,
  "amountMWK"   INTEGER            NOT NULL,
  "method"      TEXT               NOT NULL,
  "reference"   TEXT               NOT NULL,
  "notes"       TEXT,
  "status"      "RemittanceStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "reviewedBy"  TEXT,
  "reviewedAt"  TIMESTAMP(3),
  "reviewNotes" TEXT,
  "journalId"   TEXT,
  "submittedAt" TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommissionRemittance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommissionRemittance_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_remittance_amount_positive" CHECK ("amountMWK" > 0)
);

CREATE INDEX IF NOT EXISTS "CommissionRemittance_status_submittedAt_idx"
  ON "CommissionRemittance" ("status", "submittedAt");
CREATE INDEX IF NOT EXISTS "CommissionRemittance_driverId_status_idx"
  ON "CommissionRemittance" ("driverId", "status");

-- One payment reference can back only ONE active (non-rejected) remittance.
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionRemittance_reference_active_key"
  ON "CommissionRemittance" (lower("reference")) WHERE "status" <> 'REJECTED';

ALTER TABLE "CommissionRemittance" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CommissionRemittance" FROM anon, authenticated;
