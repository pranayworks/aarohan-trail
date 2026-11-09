-- A fingerprint of every uploaded driver photo, so the same image cannot be reused for another document or by another driver. ADDITIVE ONLY.
ALTER TABLE "DriverDocument" ADD COLUMN IF NOT EXISTS "fileHash" TEXT;
CREATE INDEX IF NOT EXISTS "DriverDocument_fileHash_idx" ON "DriverDocument" ("fileHash");
