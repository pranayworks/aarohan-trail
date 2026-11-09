-- Rider's description of the pickup spot, plus "call me when you are close". Additive only.
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "pickupNote" TEXT;
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "callOnArrival" BOOLEAN NOT NULL DEFAULT false;
