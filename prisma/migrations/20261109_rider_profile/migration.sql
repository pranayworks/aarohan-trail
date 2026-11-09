-- =============================================================================
-- Aarohan rider profile: personal details, referral code, up to 3 emergency contacts,
-- saved/trusted places, parcel weight and who pays. ADDITIVE ONLY.
-- =============================================================================

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User" ("referralCode");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_referredById_fkey') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey"
      FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "EmergencyContact" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"    TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "phone"     TEXT         NOT NULL,
  "relation"  TEXT,
  "position"  INTEGER      NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmergencyContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "EmergencyContact_userId_idx" ON "EmergencyContact" ("userId");

CREATE TABLE IF NOT EXISTS "SavedPlace" (
  "id"        TEXT             NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "userId"    TEXT             NOT NULL,
  "label"     TEXT             NOT NULL,
  "name"      TEXT             NOT NULL,
  "address"   TEXT,
  "lat"       DOUBLE PRECISION NOT NULL,
  "lng"       DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedPlace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedPlace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SavedPlace_userId_idx" ON "SavedPlace" ("userId");

ALTER TABLE "ParcelDetail" ADD COLUMN IF NOT EXISTS "weightKg" DOUBLE PRECISION;
ALTER TABLE "ParcelDetail" ADD COLUMN IF NOT EXISTS "payer" TEXT NOT NULL DEFAULT 'SENDER_AT_PICKUP';
ALTER TABLE "ParcelDetail" ADD COLUMN IF NOT EXISTS "pickedUpAt" TIMESTAMP(3);

ALTER TABLE "EmergencyContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedPlace" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "EmergencyContact" FROM anon, authenticated;
REVOKE ALL ON "SavedPlace" FROM anon, authenticated;
