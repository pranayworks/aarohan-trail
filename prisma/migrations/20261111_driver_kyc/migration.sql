-- Driver identity and vehicle records for strict onboarding. ADDITIVE ONLY.
-- National ID and licence numbers are stored ENCRYPTED (AES-256-GCM, app-level) plus a keyed hash
-- so the same identity cannot be used on two accounts.
CREATE TABLE IF NOT EXISTS "DriverKyc" (
  "id"                  TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "driverId"            TEXT         NOT NULL,
  "legalName"           TEXT         NOT NULL,
  "nationalIdEnc"       TEXT         NOT NULL,
  "nationalIdHash"      TEXT         NOT NULL,
  "nationalIdLast4"     TEXT         NOT NULL,
  "licenseNumberEnc"    TEXT         NOT NULL,
  "licenseHash"         TEXT         NOT NULL,
  "licenseLast4"        TEXT         NOT NULL,
  "licenseClass"        TEXT         NOT NULL,
  "licenseExpiry"       TIMESTAMP(3) NOT NULL,
  "address"             TEXT         NOT NULL,
  "district"            TEXT         NOT NULL,
  "nextOfKinName"       TEXT         NOT NULL,
  "nextOfKinPhone"      TEXT         NOT NULL,
  "nextOfKinRelation"   TEXT,
  "payoutNetwork"       TEXT         NOT NULL,
  "payoutPhone"         TEXT         NOT NULL,
  "registrationExpiry"  TIMESTAMP(3) NOT NULL,
  "insurancePolicyNo"   TEXT         NOT NULL,
  "insuranceExpiry"     TIMESTAMP(3) NOT NULL,
  "fitnessExpiry"       TIMESTAMP(3) NOT NULL,
  "declarationAcceptedAt" TIMESTAMP(3),
  "submittedAt"         TIMESTAMP(3),
  "checklist"           JSONB,
  "checklistBy"         TEXT,
  "checklistAt"         TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverKyc_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverKyc_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DriverKyc_driverId_key" ON "DriverKyc" ("driverId");
CREATE UNIQUE INDEX IF NOT EXISTS "DriverKyc_nationalIdHash_key" ON "DriverKyc" ("nationalIdHash");
CREATE UNIQUE INDEX IF NOT EXISTS "DriverKyc_licenseHash_key" ON "DriverKyc" ("licenseHash");
ALTER TABLE "DriverKyc" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "DriverKyc" FROM anon, authenticated;
