-- Live face check for drivers (turn right, left, up, down). ADDITIVE ONLY.
CREATE TABLE IF NOT EXISTS "DriverLiveness" (
  "id"              TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "driverId"        TEXT         NOT NULL,
  "challengeId"     TEXT         NOT NULL,
  "steps"           JSONB        NOT NULL,
  "issuedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "status"          TEXT         NOT NULL DEFAULT 'ISSUED',
  "framePaths"      JSONB,
  "frameHashes"     JSONB,
  "metrics"         JSONB,
  "submittedAt"     TIMESTAMP(3),
  "reviewedBy"      TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,
  "userAgent"       TEXT,
  "ipAddress"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverLiveness_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DriverLiveness_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DriverLiveness_challengeId_key" ON "DriverLiveness" ("challengeId");
CREATE INDEX IF NOT EXISTS "DriverLiveness_driverId_createdAt_idx" ON "DriverLiveness" ("driverId", "createdAt");
ALTER TABLE "DriverLiveness" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "DriverLiveness" FROM anon, authenticated;
