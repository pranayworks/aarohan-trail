-- ============================================================================
-- AArohan Smart Urban Mobility • Clean Unified Supabase Database Migration
-- Lilongwe, Malawi • PostgreSQL on Supabase (Pooler + Direct)
-- ============================================================================

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('RIDER', 'DRIVER', 'ADMIN', 'DISPATCHER', 'SUPPORT', 'FINANCE');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_VERIFICATION');
CREATE TYPE "DriverApproval" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "DriverAvailability" AS ENUM ('ONLINE', 'BUSY', 'OFFLINE');
CREATE TYPE "VehicleType" AS ENUM ('MOTO', 'AUTO', 'CAB');
CREATE TYPE "TripStatus" AS ENUM ('REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'EXPIRED', 'NO_DRIVERS');
CREATE TYPE "TripOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'REVERSED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'AIRTEL_MONEY', 'TNM_MPAMBA', 'WALLET_ESCROW');
CREATE TYPE "PaymentType" AS ENUM ('TOPUP', 'TRIP', 'PAYOUT');
CREATE TYPE "DocumentType" AS ENUM ('DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_REGISTRATION', 'CERTIFICATE_OF_FITNESS', 'INSURANCE_CERTIFICATE');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "SosStatus" AS ENUM ('ACTIVE', 'ESCALATED_POLICE', 'RESOLVED', 'FALSE_ALARM');
CREATE TYPE "LedgerAccount" AS ENUM ('RIDER', 'DRIVER', 'PLATFORM_REVENUE', 'PLATFORM_ESCROW');
CREATE TYPE "LedgerEntryType" AS ENUM ('RIDE_FARE', 'PLATFORM_COMMISSION', 'DRIVER_EARNING', 'TIP', 'CASH_COLLECTION', 'COMMISSION_DEBT', 'DEBT_SETTLEMENT', 'WALLET_TOPUP', 'P2P_TRANSFER_DEBIT', 'P2P_TRANSFER_CREDIT', 'REFUND', 'CANCELLATION_FEE', 'ADJUSTMENT');
CREATE TYPE "AuditAction" AS ENUM ('USER_LOGIN', 'USER_LOGOUT', 'USER_REGISTER', 'OTP_REQUEST', 'OTP_VERIFY_SUCCESS', 'OTP_FAILED', 'OTP_LOCKED', 'DRIVER_REGISTERED', 'DRIVER_APPROVED', 'DRIVER_REJECTED', 'DRIVER_SUSPENDED', 'TRIP_CREATED', 'TRIP_OFFERED', 'TRIP_ACCEPTED', 'TRIP_DRIVER_ARRIVED', 'TRIP_STARTED', 'TRIP_COMPLETED', 'TRIP_CANCELLED', 'PIN_VERIFIED', 'PIN_FAILED', 'PRICE_CONFIG_UPDATED', 'PAYMENT_INITIATED', 'PAYMENT_WEBHOOK', 'PAYMENT_REFUNDED', 'COMMISSION_SETTLED', 'MANUAL_ADJUSTMENT', 'SOS_TRIGGERED', 'SOS_RESOLVED');

-- CreateTable: OtpCode
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isConsumed" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable: User
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'RIDER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "passwordHash" TEXT,
    "kycTier" TEXT NOT NULL DEFAULT 'TIER_1_STANDARD',
    "avatarUrl" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Driver
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approvalStatus" "DriverApproval" NOT NULL DEFAULT 'PENDING',
    "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "tripsCompleted" INTEGER NOT NULL DEFAULT 0,
    "commissionDebtMWK" INTEGER NOT NULL DEFAULT 0,
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "currentHeading" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Vehicle
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "makeModel" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "year" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DriverDocument
CREATE TABLE "DriverDocument" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RefreshToken
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DeviceToken
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ANDROID',
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Trip
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'REQUESTED',
    "tier" "VehicleType" NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffLat" DOUBLE PRECISION NOT NULL,
    "dropoffLng" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "routeGeometry" TEXT,
    "fareMWK" INTEGER NOT NULL,
    "baseFareMWK" INTEGER NOT NULL,
    "bookingFeeMWK" INTEGER NOT NULL DEFAULT 0,
    "driverShareMWK" INTEGER NOT NULL,
    "commissionMWK" INTEGER NOT NULL,
    "driverTipMWK" INTEGER NOT NULL DEFAULT 0,
    "cancellationFeeMWK" INTEGER NOT NULL DEFAULT 0,
    "pin" TEXT NOT NULL,
    "pinAttempts" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentRef" TEXT,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TripStatusHistory
CREATE TABLE "TripStatusHistory" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "fromStatus" "TripStatus",
    "status" "TripStatus" NOT NULL,
    "changedBy" TEXT,
    "reason" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TripStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TripOffer
CREATE TABLE "TripOffer" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "TripOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TripOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ChatMessage
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Payment
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT,
    "provider" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amountMWK" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Wallet
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceMWK" INTEGER NOT NULL DEFAULT 0,
    "lockedEscrowMWK" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MWK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LedgerEntry
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "userId" TEXT,
    "walletId" TEXT,
    "tripId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "amountMWK" INTEGER NOT NULL,
    "balanceAfterMWK" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MWK',
    "description" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DriverSettlement
CREATE TABLE "DriverSettlement" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "grossFareMWK" INTEGER NOT NULL,
    "driverEarningsMWK" INTEGER NOT NULL,
    "commissionMWK" INTEGER NOT NULL,
    "commissionDebtMWK" INTEGER NOT NULL DEFAULT 0,
    "settlementStatus" TEXT NOT NULL,
    "payoutReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PricingConfig
CREATE TABLE "PricingConfig" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'MWK',
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "driverShareRate" DOUBLE PRECISION NOT NULL DEFAULT 0.70,
    "roundingUnit" INTEGER NOT NULL DEFAULT 50,
    "bookingFeeMWK" INTEGER NOT NULL DEFAULT 150,
    "waitingChargePerMinMWK" INTEGER NOT NULL DEFAULT 50,
    "freeWaitingMins" INTEGER NOT NULL DEFAULT 3,
    "cancellationFeeMWK" INTEGER NOT NULL DEFAULT 1000,
    "demandMultiplierEnabled" BOOLEAN NOT NULL DEFAULT false,
    "categoryRules" JSONB NOT NULL,
    "notes" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SosEvent
CREATE TABLE "SosEvent" (
    "id" TEXT NOT NULL,
    "tripId" TEXT,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "status" "SosStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SosEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Rating
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "tags" TEXT[],
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WebhookIdempotency
CREATE TABLE "WebhookIdempotency" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "payloadHash" TEXT,
    "responseStatus" TEXT NOT NULL DEFAULT 'PROCESSED',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Standard Indexes
CREATE UNIQUE INDEX "OtpCode_phone_key" ON "OtpCode"("phone");
CREATE INDEX "OtpCode_phone_idx" ON "OtpCode"("phone");
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE INDEX "User_phone_idx" ON "User"("phone");
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");
CREATE INDEX "Driver_approvalStatus_availability_idx" ON "Driver"("approvalStatus", "availability");
CREATE INDEX "Driver_currentLat_currentLng_idx" ON "Driver"("currentLat", "currentLng");
CREATE INDEX "Driver_userId_idx" ON "Driver"("userId");
CREATE UNIQUE INDEX "Vehicle_driverId_key" ON "Vehicle"("driverId");
CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");
CREATE INDEX "Vehicle_driverId_idx" ON "Vehicle"("driverId");
CREATE INDEX "Vehicle_plateNumber_idx" ON "Vehicle"("plateNumber");
CREATE INDEX "DriverDocument_driverId_status_idx" ON "DriverDocument"("driverId", "status");
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_tokenHash_idx" ON "RefreshToken"("userId", "tokenHash");
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");
CREATE UNIQUE INDEX "DeviceToken_userId_token_key" ON "DeviceToken"("userId", "token");

-- Trip Indexes & Scoped Idempotency
CREATE UNIQUE INDEX "Trip_riderId_idempotencyKey_key" ON "Trip"("riderId", "idempotencyKey");
CREATE INDEX "Trip_riderId_status_idx" ON "Trip"("riderId", "status");
CREATE INDEX "Trip_driverId_status_idx" ON "Trip"("driverId", "status");
CREATE INDEX "Trip_status_createdAt_idx" ON "Trip"("status", "createdAt");
CREATE INDEX "Trip_idempotencyKey_idx" ON "Trip"("idempotencyKey");
CREATE INDEX "TripStatusHistory_tripId_createdAt_idx" ON "TripStatusHistory"("tripId", "createdAt");

-- Offer, Chat & Payment Indexes
CREATE INDEX "TripOffer_driverId_status_idx" ON "TripOffer"("driverId", "status");
CREATE INDEX "TripOffer_tripId_status_idx" ON "TripOffer"("tripId", "status");
CREATE INDEX "ChatMessage_tripId_createdAt_idx" ON "ChatMessage"("tripId", "createdAt");
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE INDEX "Payment_userId_status_idx" ON "Payment"("userId", "status");
CREATE INDEX "Payment_tripId_idx" ON "Payment"("tripId");
CREATE INDEX "Payment_providerRef_idx" ON "Payment"("providerRef");
CREATE INDEX "Payment_idempotencyKey_idx" ON "Payment"("idempotencyKey");
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- LedgerEntry Indexes
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");
CREATE INDEX "LedgerEntry_account_createdAt_idx" ON "LedgerEntry"("account", "createdAt");
CREATE INDEX "LedgerEntry_journalId_idx" ON "LedgerEntry"("journalId");
CREATE INDEX "LedgerEntry_walletId_idx" ON "LedgerEntry"("walletId");
CREATE INDEX "LedgerEntry_tripId_idx" ON "LedgerEntry"("tripId");
CREATE INDEX "LedgerEntry_idempotencyKey_idx" ON "LedgerEntry"("idempotencyKey");

-- Settlements, Pricing & Audit Indexes
CREATE UNIQUE INDEX "DriverSettlement_tripId_key" ON "DriverSettlement"("tripId");
CREATE INDEX "DriverSettlement_driverId_settlementStatus_idx" ON "DriverSettlement"("driverId", "settlementStatus");
CREATE INDEX "DriverSettlement_tripId_idx" ON "DriverSettlement"("tripId");
CREATE UNIQUE INDEX "PricingConfig_versionId_key" ON "PricingConfig"("versionId");
CREATE INDEX "PricingConfig_isActive_idx" ON "PricingConfig"("isActive");
CREATE INDEX "SosEvent_userId_status_idx" ON "SosEvent"("userId", "status");
CREATE INDEX "SosEvent_tripId_idx" ON "SosEvent"("tripId");
CREATE INDEX "Rating_toUserId_idx" ON "Rating"("toUserId");
CREATE INDEX "Rating_tripId_idx" ON "Rating"("tripId");
CREATE UNIQUE INDEX "Rating_tripId_fromUserId_key" ON "Rating"("tripId", "fromUserId");
CREATE INDEX "WebhookIdempotency_provider_webhookId_idx" ON "WebhookIdempotency"("provider", "webhookId");
CREATE UNIQUE INDEX "WebhookIdempotency_provider_webhookId_key" ON "WebhookIdempotency"("provider", "webhookId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- Foreign Keys
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TripStatusHistory" ADD CONSTRAINT "TripStatusHistory_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripOffer" ADD CONSTRAINT "TripOffer_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripOffer" ADD CONSTRAINT "TripOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce Restrict on User deletion for financial and audit immutability (anonymization only)
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DriverSettlement" ADD CONSTRAINT "DriverSettlement_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DriverSettlement" ADD CONSTRAINT "DriverSettlement_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SosEvent" ADD CONSTRAINT "SosEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- EMBEDDED HARDENING & CONSTRAINTS
-- ============================================================================

-- 1. Revoke public/PostgREST permissions from anon and authenticated roles
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- 2. Enable Row Level Security (RLS) on all 20 tables + _prisma_migrations
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Driver" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtpCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DeviceToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TripStatusHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TripOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Wallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriverSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PricingConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookIdempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SosEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Rating" ENABLE ROW LEVEL SECURITY;

-- 3. CHECK Constraints: Rating stars 1-5, PIN attempts 0-5, non-negative money
ALTER TABLE "Rating" ADD CONSTRAINT "rating_stars_range" CHECK ("stars" >= 1 AND "stars" <= 5);
ALTER TABLE "Trip" ADD CONSTRAINT "trip_pin_attempts_range" CHECK ("pinAttempts" >= 0 AND "pinAttempts" <= 5);
ALTER TABLE "Trip" ADD CONSTRAINT "trip_fare_non_negative" CHECK ("fareMWK" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "trip_base_fare_non_negative" CHECK ("baseFareMWK" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "trip_driver_share_non_negative" CHECK ("driverShareMWK" >= 0);
ALTER TABLE "Trip" ADD CONSTRAINT "trip_commission_non_negative" CHECK ("commissionMWK" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amountMWK" > 0);
ALTER TABLE "Wallet" ADD CONSTRAINT "wallet_balance_non_negative" CHECK ("balanceMWK" >= 0);
ALTER TABLE "Wallet" ADD CONSTRAINT "wallet_locked_escrow_non_negative" CHECK ("lockedEscrowMWK" >= 0);

-- 4. Partial Unique Indexes
-- A. Exactly one ACCEPTED offer per trip
CREATE UNIQUE INDEX "unique_accepted_offer_per_trip" ON "TripOffer"("tripId") WHERE "status" = 'ACCEPTED';

-- B. At most one active trip per rider
CREATE UNIQUE INDEX "unique_active_trip_per_rider" ON "Trip"("riderId") 
WHERE "status" IN ('REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT');

-- C. At most one active trip per driver
CREATE UNIQUE INDEX "unique_active_trip_per_driver" ON "Trip"("driverId") 
WHERE "status" IN ('DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT') AND "driverId" IS NOT NULL;

-- 5. Trigger Functions (SET search_path = '', WITHOUT SECURITY DEFINER)
CREATE OR REPLACE FUNCTION prevent_update_or_delete()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is strictly append-only. UPDATE and DELETE operations are forbidden.', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_truncate()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Table % is strictly append-only. TRUNCATE operations are forbidden.', TG_TABLE_NAME;
END;
$$;

-- Row-level triggers rejecting UPDATE and DELETE
DROP TRIGGER IF EXISTS trg_ledger_entry_immutable_row ON "LedgerEntry";
CREATE TRIGGER trg_ledger_entry_immutable_row
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION prevent_update_or_delete();

DROP TRIGGER IF EXISTS trg_audit_log_immutable_row ON "AuditLog";
CREATE TRIGGER trg_audit_log_immutable_row
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_update_or_delete();

-- Statement-level triggers rejecting TRUNCATE
DROP TRIGGER IF EXISTS trg_ledger_entry_immutable_truncate ON "LedgerEntry";
CREATE TRIGGER trg_ledger_entry_immutable_truncate
BEFORE TRUNCATE ON "LedgerEntry"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_truncate();

DROP TRIGGER IF EXISTS trg_audit_log_immutable_truncate ON "AuditLog";
CREATE TRIGGER trg_audit_log_immutable_truncate
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_truncate();
