-- Audit trail entries for the ads feature. New enum values only.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AD_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'AD_DELETED';
