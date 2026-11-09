-- Ads shown inside the rider and driver apps, and a log of every email / push / SMS the platform sends. ADDITIVE ONLY.
CREATE TABLE IF NOT EXISTS "Ad" (
  "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "audience"    TEXT         NOT NULL,
  "title"       TEXT         NOT NULL,
  "caption"     TEXT,
  "mediaType"   TEXT         NOT NULL,
  "mediaPath"   TEXT         NOT NULL,
  "mediaUrl"    TEXT         NOT NULL,
  "linkUrl"     TEXT,
  "startsAt"    TIMESTAMP(3),
  "endsAt"      TIMESTAMP(3),
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "priority"    INTEGER      NOT NULL DEFAULT 0,
  "impressions" INTEGER      NOT NULL DEFAULT 0,
  "clicks"      INTEGER      NOT NULL DEFAULT 0,
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Ad_audience_active_idx" ON "Ad" ("audience", "active");

CREATE TABLE IF NOT EXISTS "MessageLog" (
  "id"        TEXT         NOT NULL DEFAULT gen_random_uuid()::TEXT,
  "channel"   TEXT         NOT NULL,
  "purpose"   TEXT         NOT NULL,
  "toMasked"  TEXT         NOT NULL,
  "userId"    TEXT,
  "subject"   TEXT,
  "status"    TEXT         NOT NULL,
  "provider"  TEXT,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MessageLog_channel_createdAt_idx" ON "MessageLog" ("channel", "createdAt");
CREATE INDEX IF NOT EXISTS "MessageLog_userId_createdAt_idx" ON "MessageLog" ("userId", "createdAt");

ALTER TABLE "Ad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "Ad" FROM anon, authenticated;
REVOKE ALL ON "MessageLog" FROM anon, authenticated;
