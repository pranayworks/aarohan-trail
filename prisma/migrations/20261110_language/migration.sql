-- Rider's chosen app language (en or ny). Additive only.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "language" TEXT;
