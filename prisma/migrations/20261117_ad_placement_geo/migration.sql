-- Ads: WHICH SCREEN shows the ad (placement) and an optional place + radius so only people nearby see it. ADDITIVE ONLY.
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "placement"   TEXT NOT NULL DEFAULT 'HOME';
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "geoLat"      DOUBLE PRECISION;
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "geoLng"      DOUBLE PRECISION;
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "geoRadiusKm" DOUBLE PRECISION;
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "geoLabel"    TEXT;
CREATE INDEX IF NOT EXISTS "Ad_audience_placement_idx" ON "Ad" ("audience", "placement");
