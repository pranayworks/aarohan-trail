-- New enum values only (kept in their own migration: Postgres does not let a new value be used in the same transaction).
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PROFILE_UPDATED';
