-- ============================================================================
-- AArohan Smart Urban Mobility • Post-Migration Database Hardening
-- Lilongwe, Malawi • PostgreSQL on Supabase
-- Executed after Prisma tables are created:
--   1. Enable Row Level Security (RLS) on all tables (blocks unauthorized PostgREST)
--   2. Enforce Non-Negative Wallet Balance (balanceMWK >= 0)
--   3. Apply Immutability Triggers on LedgerEntry and AuditLog
-- ============================================================================

-- 1. Enable Row Level Security (RLS) on ALL tables with NO public policies
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Driver" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtpCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TripOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Wallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PricingConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookIdempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SosEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Rating" ENABLE ROW LEVEL SECURITY;

-- 2. Enforce Non-Negative Wallet Balance (strictly prevents overdrafts & negative ledger balances)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_balance_non_negative'
  ) THEN
    ALTER TABLE "Wallet" ADD CONSTRAINT "wallet_balance_non_negative" CHECK ("balanceMWK" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_locked_escrow_non_negative'
  ) THEN
    ALTER TABLE "Wallet" ADD CONSTRAINT "wallet_locked_escrow_non_negative" CHECK ("lockedEscrowMWK" >= 0);
  END IF;
END $$;

-- 3. Append-Only Trigger Function: Rejects UPDATE and DELETE on immutable financial/audit tables
CREATE OR REPLACE FUNCTION prevent_update_or_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Table % is strictly append-only. UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Trigger: LedgerEntry is immutable
DROP TRIGGER IF EXISTS trg_ledger_entry_immutable ON "LedgerEntry";
CREATE TRIGGER trg_ledger_entry_immutable
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION prevent_update_or_delete();

-- Trigger: AuditLog is immutable
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON "AuditLog";
CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_update_or_delete();
