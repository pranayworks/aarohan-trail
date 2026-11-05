-- =============================================================================
-- AArohan Package 1: Legal/Safety Records — ADDITIVE ONLY Migration
-- Lilongwe, Malawi • Applied to DEV database only
-- NEVER drops, renames or alters existing data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. NEW ENUM VALUES (ADDITIVE only — ALTER TYPE ... ADD VALUE)
-- ---------------------------------------------------------------------------

-- ServiceType enum
DO $$ BEGIN
  CREATE TYPE "ServiceType" AS ENUM ('RIDE', 'PARCEL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ParcelSize enum
DO $$ BEGIN
  CREATE TYPE "ParcelSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TicketStatus enum
DO $$ BEGIN
  CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TicketPriority enum
DO $$ BEGIN
  CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ConsentDocumentType enum
DO $$ BEGIN
  CREATE TYPE "ConsentDocumentType" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'DRIVER_AGREEMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add new AuditAction values (additive — no existing values removed)
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_TRIP_RECORD_VIEWED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_GPS_TRAIL_VIEWED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_CHAT_VIEWED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_TICKETS_VIEWED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_CREATED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_MESSAGE_ADDED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TICKET_RESOLVED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONSENT_RECORDED';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PARCEL_DELIVERY_CODE_ATTEMPT';
EXCEPTION WHEN others THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PARCEL_DELIVERED';
EXCEPTION WHEN others THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 1. ADDITIVE COLUMNS ON EXISTING TABLES
-- ---------------------------------------------------------------------------

-- User: add riderRating + ratingCount
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "riderRating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS "ratingCount"  INTEGER          NOT NULL DEFAULT 0;

ALTER TABLE "User"
  ADD CONSTRAINT "user_rider_rating_range" CHECK ("riderRating" >= 1.0 AND "riderRating" <= 5.0);

ALTER TABLE "User"
  ADD CONSTRAINT "user_rating_count_nonneg" CHECK ("ratingCount" >= 0);

-- Driver: add ratingCount
ALTER TABLE "Driver"
  ADD COLUMN IF NOT EXISTS "ratingCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Driver"
  ADD CONSTRAINT "driver_rating_count_nonneg" CHECK ("ratingCount" >= 0);

-- Trip: add serviceType, stopCount, stopFeeMWK
ALTER TABLE "Trip"
  ADD COLUMN IF NOT EXISTS "serviceType"  "ServiceType" NOT NULL DEFAULT 'RIDE',
  ADD COLUMN IF NOT EXISTS "stopCount"    INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stopFeeMWK"  INTEGER       NOT NULL DEFAULT 0;

ALTER TABLE "Trip"
  ADD CONSTRAINT "trip_stop_count_range"  CHECK ("stopCount" >= 0 AND "stopCount" <= 2);
ALTER TABLE "Trip"
  ADD CONSTRAINT "trip_stop_fee_nonneg"   CHECK ("stopFeeMWK" >= 0);

CREATE INDEX IF NOT EXISTS "Trip_serviceType_status_idx" ON "Trip" ("serviceType", "status");

-- PricingConfig: add stopFeeMWK + parcel size multipliers
ALTER TABLE "PricingConfig"
  ADD COLUMN IF NOT EXISTS "stopFeeMWK"       INTEGER          NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "parcelSmallMult"  DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "parcelMediumMult" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
  ADD COLUMN IF NOT EXISTS "parcelLargeMult"  DOUBLE PRECISION NOT NULL DEFAULT 1.6;

ALTER TABLE "PricingConfig"
  ADD CONSTRAINT "pricing_stop_fee_nonneg"       CHECK ("stopFeeMWK" >= 0),
  ADD CONSTRAINT "pricing_parcel_small_mult_pos"  CHECK ("parcelSmallMult" > 0),
  ADD CONSTRAINT "pricing_parcel_medium_mult_pos" CHECK ("parcelMediumMult" > 0),
  ADD CONSTRAINT "pricing_parcel_large_mult_pos"  CHECK ("parcelLargeMult" > 0);

-- ---------------------------------------------------------------------------
-- 2. NEW TABLE: TripStop
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "TripStop" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "tripId"    TEXT         NOT NULL,
  "sequence"  INTEGER      NOT NULL,  -- 1 or 2
  "address"   TEXT         NOT NULL,
  "lat"       DOUBLE PRECISION NOT NULL,
  "lng"       DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripStop_tripId_sequence_key" UNIQUE ("tripId", "sequence"),
  CONSTRAINT "TripStop_sequence_range" CHECK ("sequence" >= 1 AND "sequence" <= 2),
  CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId")
    REFERENCES "Trip"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "TripStop_tripId_idx" ON "TripStop" ("tripId");

-- RLS
ALTER TABLE "TripStop" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "TripStop" FROM anon, authenticated;

CREATE POLICY "TripStop_service_role_only" ON "TripStop"
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 3. NEW TABLE: TripLocationPoint (append-only GPS trail)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "TripLocationPoint" (
  "id"         TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "tripId"     TEXT             NOT NULL,
  "driverId"   TEXT             NOT NULL,
  "lat"        DOUBLE PRECISION NOT NULL,
  "lng"        DOUBLE PRECISION NOT NULL,
  "speed"      DOUBLE PRECISION,         -- km/h, nullable
  "heading"    DOUBLE PRECISION,         -- 0–359 degrees, nullable
  "recordedAt" TIMESTAMPTZ      NOT NULL, -- device timestamp
  "createdAt"  TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT "TripLocationPoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TripLocationPoint_lat_range"  CHECK ("lat"  >= -90  AND "lat"  <= 90),
  CONSTRAINT "TripLocationPoint_lng_range"  CHECK ("lng"  >= -180 AND "lng"  <= 180),
  CONSTRAINT "TripLocationPoint_speed_nn"   CHECK ("speed"   IS NULL OR "speed"   >= 0),
  CONSTRAINT "TripLocationPoint_heading_nn" CHECK ("heading" IS NULL OR ("heading" >= 0 AND "heading" < 360)),
  CONSTRAINT "TripLocationPoint_tripId_fkey" FOREIGN KEY ("tripId")
    REFERENCES "Trip"("id") ON DELETE CASCADE,
  CONSTRAINT "TripLocationPoint_driverId_fkey" FOREIGN KEY ("driverId")
    REFERENCES "Driver"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "TripLocationPoint_tripId_recordedAt_idx"
  ON "TripLocationPoint" ("tripId", "recordedAt");
CREATE INDEX IF NOT EXISTS "TripLocationPoint_driverId_recordedAt_idx"
  ON "TripLocationPoint" ("driverId", "recordedAt");

-- RLS
ALTER TABLE "TripLocationPoint" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "TripLocationPoint" FROM anon, authenticated;

CREATE POLICY "TripLocationPoint_service_role_only" ON "TripLocationPoint"
  USING (auth.role() = 'service_role');

-- Append-only: prevent UPDATE and DELETE on rows
CREATE OR REPLACE FUNCTION "fn_triploationpoint_no_mutate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TripLocationPoint is append-only: UPDATE and DELETE are not permitted.';
END;
$$;

CREATE TRIGGER "trg_triploactionpoint_no_update"
  BEFORE UPDATE ON "TripLocationPoint"
  FOR EACH ROW EXECUTE FUNCTION "fn_triploationpoint_no_mutate"();

CREATE TRIGGER "trg_triploactionpoint_no_delete"
  BEFORE DELETE ON "TripLocationPoint"
  FOR EACH ROW EXECUTE FUNCTION "fn_triploationpoint_no_mutate"();

-- Append-only: prevent TRUNCATE
CREATE OR REPLACE FUNCTION "fn_triploactionpoint_no_truncate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TripLocationPoint is append-only: TRUNCATE is not permitted.';
END;
$$;

CREATE TRIGGER "trg_triploactionpoint_no_truncate"
  BEFORE TRUNCATE ON "TripLocationPoint"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_triploactionpoint_no_truncate"();

-- ---------------------------------------------------------------------------
-- 4. NEW TABLE: ParcelDetail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ParcelDetail" (
  "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "tripId"            TEXT         NOT NULL,
  "category"          TEXT         NOT NULL,
  "size"              "ParcelSize" NOT NULL,
  "fragile"           BOOLEAN      NOT NULL DEFAULT false,
  "notes"             TEXT,
  "recipientName"     TEXT         NOT NULL,
  "recipientPhone"    TEXT         NOT NULL,
  "deliveryCodeHash"  TEXT         NOT NULL,
  "deliveryAttempts"  INTEGER      NOT NULL DEFAULT 0,
  "deliveredAt"       TIMESTAMPTZ,
  "proofNote"         TEXT,
  "createdAt"         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT "ParcelDetail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParcelDetail_tripId_key" UNIQUE ("tripId"),
  CONSTRAINT "ParcelDetail_delivery_attempts_range" CHECK ("deliveryAttempts" >= 0 AND "deliveryAttempts" <= 5),
  CONSTRAINT "ParcelDetail_recipient_phone_format" CHECK ("recipientPhone" ~ '^\+265[0-9]{9}$'),
  CONSTRAINT "ParcelDetail_tripId_fkey" FOREIGN KEY ("tripId")
    REFERENCES "Trip"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ParcelDetail_tripId_idx" ON "ParcelDetail" ("tripId");

-- RLS
ALTER TABLE "ParcelDetail" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ParcelDetail" FROM anon, authenticated;

CREATE POLICY "ParcelDetail_service_role_only" ON "ParcelDetail"
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 5. NEW TABLE: SupportTicket
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id"          TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"      TEXT             NOT NULL,
  "tripId"      TEXT,
  "category"    TEXT             NOT NULL,
  "subject"     TEXT             NOT NULL,
  "description" TEXT             NOT NULL,
  "status"      "TicketStatus"   NOT NULL DEFAULT 'OPEN',
  "priority"    "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
  "assignedTo"  TEXT,
  "resolution"  TEXT,
  "createdAt"   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  "resolvedAt"  TIMESTAMPTZ,
  "updatedAt"   TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id"),
  CONSTRAINT "SupportTicket_tripId_fkey" FOREIGN KEY ("tripId")
    REFERENCES "Trip"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "SupportTicket_userId_status_idx"
  ON "SupportTicket" ("userId", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_tripId_idx"
  ON "SupportTicket" ("tripId");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_priority_createdAt_idx"
  ON "SupportTicket" ("status", "priority", "createdAt");

-- RLS
ALTER TABLE "SupportTicket" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SupportTicket" FROM anon, authenticated;

CREATE POLICY "SupportTicket_service_role_only" ON "SupportTicket"
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 6. NEW TABLE: TicketMessage (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "TicketMessage" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "ticketId"   TEXT        NOT NULL,
  "authorId"   TEXT        NOT NULL,
  "authorRole" TEXT        NOT NULL,
  "body"       TEXT        NOT NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketMessage_authorRole_values"
    CHECK ("authorRole" IN ('RIDER','DRIVER','ADMIN','SUPPORT','FINANCE')),
  CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId")
    REFERENCES "SupportTicket"("id") ON DELETE CASCADE,
  CONSTRAINT "TicketMessage_authorId_fkey" FOREIGN KEY ("authorId")
    REFERENCES "User"("id")
);

CREATE INDEX IF NOT EXISTS "TicketMessage_ticketId_createdAt_idx"
  ON "TicketMessage" ("ticketId", "createdAt");

-- RLS
ALTER TABLE "TicketMessage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "TicketMessage" FROM anon, authenticated;

CREATE POLICY "TicketMessage_service_role_only" ON "TicketMessage"
  USING (auth.role() = 'service_role');

-- Append-only: prevent UPDATE and DELETE on rows
CREATE OR REPLACE FUNCTION "fn_ticketmessage_no_mutate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TicketMessage is append-only: UPDATE and DELETE are not permitted.';
END;
$$;

CREATE TRIGGER "trg_ticketmessage_no_update"
  BEFORE UPDATE ON "TicketMessage"
  FOR EACH ROW EXECUTE FUNCTION "fn_ticketmessage_no_mutate"();

CREATE TRIGGER "trg_ticketmessage_no_delete"
  BEFORE DELETE ON "TicketMessage"
  FOR EACH ROW EXECUTE FUNCTION "fn_ticketmessage_no_mutate"();

-- Append-only: prevent TRUNCATE
CREATE OR REPLACE FUNCTION "fn_ticketmessage_no_truncate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TicketMessage is append-only: TRUNCATE is not permitted.';
END;
$$;

CREATE TRIGGER "trg_ticketmessage_no_truncate"
  BEFORE TRUNCATE ON "TicketMessage"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_ticketmessage_no_truncate"();

-- ---------------------------------------------------------------------------
-- 7. NEW TABLE: ConsentRecord
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ConsentRecord" (
  "id"           TEXT                   NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"       TEXT                   NOT NULL,
  "documentType" "ConsentDocumentType"  NOT NULL,
  "version"      TEXT                   NOT NULL,
  "acceptedAt"   TIMESTAMPTZ            NOT NULL DEFAULT now(),
  "ipHash"       TEXT,

  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id")
);

CREATE INDEX IF NOT EXISTS "ConsentRecord_userId_documentType_idx"
  ON "ConsentRecord" ("userId", "documentType");
CREATE INDEX IF NOT EXISTS "ConsentRecord_documentType_version_idx"
  ON "ConsentRecord" ("documentType", "version");

-- RLS
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ConsentRecord" FROM anon, authenticated;

CREATE POLICY "ConsentRecord_service_role_only" ON "ConsentRecord"
  USING (auth.role() = 'service_role');

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

