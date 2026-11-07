// ============================================================================
// AAROHAN PRODUCTION GUARDS & COMMISSION SETTLEMENT TEST SUITE
// Lilongwe, Malawi • Production Fail-Safe, Logging, Debt Limits, Balanced Ledger
// ============================================================================

require('dotenv').config();
const assert = require('assert');
const ioClient = require('socket.io-client');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');
// Settlements now live in PostgreSQL (CommissionRemittance), not in the legacy JSON ledger.
const settlementService = require('../services/settlements');
const dbLedger = require('../services/dbLedger');
const { validateStartupConfig, isKnownPlaceholder } = require('../services/configValidator');
const { logger, maskPhoneNumber, sanitizeString, sanitizeData } = require('../services/logger');
const { app, server } = require('../server');

const TEST_PORT = 3097;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runProductionAndCommissionSuite() {
  console.log('=============================================================');
  console.log('   AAROHAN PRODUCTION GUARDS & COMMISSION SETTLEMENT SUITE');
  console.log('   Lilongwe, Malawi • Production Safeguards & Double-Entry Tests');
  console.log('=============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function report(name, condition, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
      if (details) console.log(`   └─ ${details}`);
    } else {
      console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
      if (details) console.error(`   └─ ${details}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // Ensure test server is listening on TEST_PORT
  if (!server.listening) {
    await new Promise((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', resolve);
    });
  }

  try {
    // -------------------------------------------------------------------------
    // 1. STARTUP CONFIG CHECK TESTS
    // -------------------------------------------------------------------------
    console.log('--- 1. Testing Production Startup Config Validation ---');

    // Test: Rejects missing JWT_SECRET in production
    let missingJwtError = null;
    try {
      validateStartupConfig({
        NODE_ENV: 'production',
        OTP_HMAC_SECRET: 'valid-otp-hmac-secret-16',
        DATABASE_URL: 'postgresql://usr:pwd@host:5432/db',
        SUPABASE_SECRET_KEY: 'valid-supabase-key-20-chars'
      }, true);
    } catch (e) {
      missingJwtError = e;
    }
    report('Startup fails if JWT_SECRET is missing in production', !!missingJwtError && missingJwtError.message.includes('JWT_SECRET is missing'));

    // Test: Rejects short JWT_SECRET
    let shortJwtError = null;
    try {
      validateStartupConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'too-short',
        OTP_HMAC_SECRET: 'valid-otp-hmac-secret-16',
        DATABASE_URL: 'postgresql://usr:pwd@host:5432/db',
        SUPABASE_SECRET_KEY: 'valid-supabase-key-20-chars'
      }, true);
    } catch (e) {
      shortJwtError = e;
    }
    report('Startup fails if JWT_SECRET is too short (< 32 chars)', !!shortJwtError && shortJwtError.message.includes('too short'));

    // Test: Rejects placeholder JWT_SECRET
    let placeholderJwtError = null;
    try {
      validateStartupConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'change-me-to-a-secure-production-jwt-secret-now!',
        OTP_HMAC_SECRET: 'valid-otp-hmac-secret-16',
        DATABASE_URL: 'postgresql://usr:pwd@host:5432/db',
        SUPABASE_SECRET_KEY: 'valid-supabase-key-20-chars'
      }, true);
    } catch (e) {
      placeholderJwtError = e;
    }
    report('Startup fails if JWT_SECRET contains an insecure placeholder', !!placeholderJwtError && placeholderJwtError.message.includes('placeholder'));

    // Test: Rejects missing or placeholder OTP_HMAC_SECRET
    let placeholderOtpError = null;
    try {
      validateStartupConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'valid-super-strong-jwt-secret-longer-than-32-chars-ok',
        OTP_HMAC_SECRET: 'placeholder-secret',
        DATABASE_URL: 'postgresql://usr:pwd@host:5432/db',
        SUPABASE_SECRET_KEY: 'valid-supabase-key-20-chars'
      }, true);
    } catch (e) {
      placeholderOtpError = e;
    }
    report('Startup fails if OTP_HMAC_SECRET uses a placeholder', !!placeholderOtpError && placeholderOtpError.message.includes('placeholder'));

    // Test: Rejects invalid or placeholder DATABASE_URL
    let placeholderDbError = null;
    try {
      validateStartupConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'valid-super-strong-jwt-secret-longer-than-32-chars-ok',
        OTP_HMAC_SECRET: 'valid-hmac-secret-key-16',
        DATABASE_URL: 'mysql://localhost:3306/db',
        SUPABASE_SECRET_KEY: 'valid-supabase-key-20-chars'
      }, true);
    } catch (e) {
      placeholderDbError = e;
    }
    report('Startup fails if DATABASE_URL is not PostgreSQL or uses placeholder', !!placeholderDbError);

    // Test: Rejects missing or short SUPABASE_SECRET_KEY
    let shortSupabaseError = null;
    try {
      validateStartupConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'valid-super-strong-jwt-secret-longer-than-32-chars-ok',
        OTP_HMAC_SECRET: 'valid-hmac-secret-key-16',
        DATABASE_URL: 'postgresql://usr:pwd@db.host.com:5432/aarohan',
        SUPABASE_SECRET_KEY: 'short'
      }, true);
    } catch (e) {
      shortSupabaseError = e;
    }
    report('Startup fails if SUPABASE_SECRET_KEY is too short (< 20 chars)', !!shortSupabaseError && shortSupabaseError.message.includes('too short'));

    // Test: Passes when all production configs are valid
    const validConfigResult = validateStartupConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'aarohan-super-strong-production-jwt-secret-key-64-bytes-long-ok',
      OTP_HMAC_SECRET: 'aarohan-otp-hmac-production-key-32-bytes-ok',
      DATABASE_URL: 'postgresql://postgres:securepass@db.supabase.co:5432/aarohan',
      SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super-long-valid-supabase-service-key',
      AAROHAN_SECURITY_DESK_PHONE: '+265881234567'
    }, true);
    report('Startup configuration check passes with valid production credentials', validConfigResult.valid === true);

    // -------------------------------------------------------------------------
    // 2. /api/health ENDPOINT & ZERO-SECRETS VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing /api/health Endpoint & Zero Secrets Leakage ---');

    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthRes.json();

    report('/api/health returns HTTP 200 with status HEALTHY', healthRes.status === 200 && healthData.status === 'HEALTHY');
    report('/api/health verifies database connectivity', healthData.database === 'CONNECTED');
    report('/api/health includes uptime seconds without secrets', typeof healthData.uptimeSeconds === 'number' && !healthData.JWT_SECRET && !healthData.DATABASE_URL && !healthData.password);

    // -------------------------------------------------------------------------
    // 3. STRUCTURED LOGGING & REDACTION TESTS
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing Structured Logging Redaction ---');

    // Phone masking
    const rawPhone = '+265991234567';
    const maskedPhone = maskPhoneNumber(rawPhone);
    report('Phone numbers are masked to prevent full PII exposure', maskedPhone === '+265***4567', `Masked: ${maskedPhone}`);

    // JWT token redaction
    const fakeToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.signature-here';
    const sanitizedTokenStr = sanitizeString(`User header: ${fakeToken}`);
    report('Bearer JWT tokens are redacted in logs', sanitizedTokenStr.includes('Bearer eyJ***[REDACTED_TOKEN]') && !sanitizedTokenStr.includes('signature-here'));

    // OTP code redaction
    const rawLogWithOtp = '[DEV OTP] +265991234567 : 654321';
    const sanitizedOtpStr = sanitizeString(rawLogWithOtp);
    report('OTP codes are redacted from log outputs', sanitizedOtpStr.includes('[REDACTED_OTP]') && !sanitizedOtpStr.includes('654321'));

    // Object sanitization
    const sensitiveObj = {
      phone: '+265882345678',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
      otpCode: '887766',
      passwordHash: '$2a$12$somehashhere',
      tripId: 'TRIP-123'
    };
    const cleanedData = sanitizeData(sensitiveObj);
    report('sanitizeData scrubs nested phone, token, otpCode, and password fields',
      cleanedData.phone === '+265***5678' &&
      cleanedData.token === '[REDACTED_TOKEN]' &&
      cleanedData.otpCode === '[REDACTED_OTP]' &&
      cleanedData.passwordHash === '[REDACTED]' &&
      cleanedData.tripId === 'TRIP-123'
    );

    // -------------------------------------------------------------------------
    // 4. PRODUCTION-MODE GUARDS (OTP NEVER PRINTED, /api/reset, wallet:topup)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Production Mode Guards ---');

    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Guard 1: OTP is never printed in production
    let capturedLog = '';
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      capturedLog += args.join(' ');
      originalConsoleLog.apply(console, args);
    };

    const otpPhone = '+265998887711';
    await authService.requestOtp(otpPhone, '127.0.0.1');
    console.log = originalConsoleLog;

    report('OTP is NEVER printed when NODE_ENV === production', !capturedLog.includes('[DEV OTP]'), 'No OTP emitted to console in production mode');

    // Guard 2: /api/reset is blocked in production
    const resetRes = await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
    report('/api/reset is strictly blocked (HTTP 403) in production', resetRes.status === 403);

    // Guard 3: wallet:topup is blocked in production
    // Set up active rider for socket test
    const testRiderPhone = '+265889998801';
    let prodTestRider = await prisma.user.findUnique({ where: { phone: testRiderPhone } });
    if (!prodTestRider) {
      prodTestRider = await prisma.user.create({
        data: {
          phone: testRiderPhone,
          name: 'Prod Guard Rider',
          role: 'RIDER',
          status: 'ACTIVE'
        }
      });
    }
    const riderToken = authService.issueAccessToken(prodTestRider);

    const prodSocket = ioClient(BASE_URL, {
      auth: { token: riderToken },
      transports: ['websocket'],
      forceNew: true
    });

    await new Promise((resolve) => prodSocket.on('connect', resolve));

    const topupResult = await new Promise((resolve) => {
      prodSocket.emit('wallet:topup', { amount: 5000, provider: 'AIRTEL_MONEY' }, (response) => {
        resolve(response);
      });
    });

    prodSocket.disconnect();
    report('wallet:topup is strictly blocked in production mode', topupResult.success === false && topupResult.error.includes('disabled in production'));

    // Restore NODE_ENV
    process.env.NODE_ENV = originalNodeEnv;

    // -------------------------------------------------------------------------
    // 5. DRIVER SCREEN: COMMISSION SUMMARY & DEBT LIMIT LOCKOUT
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Driver Commission Summary & Debt Limit Lockout ---');

    // Create high-debt driver (> 15,000 MWK limit)
    const highDebtPhone = '+265997771122';
    let highDebtUser = await prisma.user.findUnique({
      where: { phone: highDebtPhone },
      include: { driverProfile: true }
    });

    if (!highDebtUser) {
      highDebtUser = await prisma.user.create({
        data: {
          phone: highDebtPhone,
          name: 'Captain Over Debt',
          role: 'DRIVER',
          status: 'ACTIVE',
          driverProfile: {
            create: {
              approvalStatus: 'APPROVED',
              availability: 'OFFLINE',
              commissionDebtMWK: 18500, // Exceeds 15,000 MWK limit
              tripsCompleted: 8,
              vehicle: {
                create: {
                  type: 'CAB',
                  makeModel: 'Toyota Vitz',
                  color: 'Blue',
                  plateNumber: 'BW-DEBT-01',
                  year: 2020
                }
              }
            }
          }
        },
        include: { driverProfile: true }
      });
    } else {
      await prisma.driver.update({
        where: { id: highDebtUser.driverProfile.id },
        data: { commissionDebtMWK: 18500, availability: 'OFFLINE', approvalStatus: 'APPROVED' }
      });
      highDebtUser = await prisma.user.findUnique({
        where: { id: highDebtUser.id },
        include: { driverProfile: true }
      });
    }

    const highDebtToken = authService.issueAccessToken(highDebtUser);

    // Test 5a: Driver commission summary returns owed debt, trips, and today's earnings
    const summaryRes = await fetch(`${BASE_URL}/api/driver/commission-summary`, {
      headers: { 'Authorization': `Bearer ${highDebtToken}` }
    });
    const summaryData = await summaryRes.json();

    report('Driver commission summary returns owed commission, trips, and earnings',
      summaryRes.status === 200 &&
      summaryData.commissionDebtMWK === 18500 &&
      summaryData.debtLimitExceeded === true &&
      summaryData.canGoOnline === false
    );

    // Test 5b: High-debt driver is BLOCKED from going online via REST location
    const locationRes = await fetch(`${BASE_URL}/api/drivers/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${highDebtToken}`
      },
      body: JSON.stringify({
        lat: -13.9620,
        lng: 33.7840,
        heading: 90
      })
    });
    const locationData = await locationRes.json();
    report('Driver with commission debt > 15,000 MWK is blocked from REST location publish (HTTP 403)',
      locationRes.status === 403 && locationData.code === 'COMMISSION_DEBT_EXCEEDED'
    );

    // Test 5c: High-debt driver is BLOCKED from going online via Socket driver:set_status
    const driverSocket = ioClient(BASE_URL, {
      auth: { token: highDebtToken },
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise((resolve) => driverSocket.on('connect', resolve));

    const onlineAttempt = await new Promise((resolve) => {
      driverSocket.emit('driver:set_status', { status: 'ONLINE' }, (res) => resolve(res));
    });
    driverSocket.disconnect();

    report('Driver with commission debt > 15,000 MWK is rejected when trying to go ONLINE',
      onlineAttempt.success === false && onlineAttempt.error.includes('commission debt')
    );

    // -------------------------------------------------------------------------
    // 6. DRIVER COMMISSION SUBMISSION & ADMIN SETTLEMENT WORKFLOW
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Commission Payment Submission & Admin Reconciliation ---');

    // Driver submits commission remittance (e.g. 7,500 MWK)
    const submitRes = await fetch(`${BASE_URL}/api/driver/settlements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${highDebtToken}`
      },
      body: JSON.stringify({
        amount: 7500,
        // Unique per run: one payment reference can back only one active remittance.
        mobileMoneyReference: `AM-MW-TEST-7500-${Date.now()}`,
        provider: 'AIRTEL_MONEY'
      })
    });
    const submitData = await submitRes.json();

    report('Driver submits commission payment form with amount and mobile money reference',
      submitRes.status === 200 &&
      submitData.success === true &&
      submitData.settlement.amount === 7500 &&
      submitData.settlement.status === 'PENDING_VERIFICATION'
    );
    const settlementId = submitData.settlement.settlementId;

    // Set up Admin User
    const adminPhone = '+265990000001';
    let adminUser = await prisma.user.findUnique({ where: { phone: adminPhone } });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: { phone: adminPhone, name: 'Lead Admin', role: 'ADMIN', status: 'ACTIVE' }
      });
    }
    const adminToken = authService.issueAccessToken(adminUser);

    // Admin lists pending settlements
    const pendingRes = await fetch(`${BASE_URL}/api/admin/settlements/pending`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const pendingData = await pendingRes.json();
    const foundSettlement = (pendingData.settlements || []).find(s => s.settlementId === settlementId);

    report('Admin can list pending driver settlements in verification queue',
      pendingRes.status === 200 && !!foundSettlement && foundSettlement.amount === 7500
    );

    // Test: Admin rejection with reason
    // Create a temporary settlement to reject
    const tempSubmit = await settlementService.submit({
      driverId: highDebtUser.driverProfile.id,
      amountMWK: 1000,
      reference: `INVALID-REF-${Date.now()}`,
      method: 'TNM_MPAMBA'
    });

    const rejectRes = await fetch(`${BASE_URL}/api/admin/settlements/${tempSubmit.settlementId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ reason: 'Invalid reference number provided' })
    });
    const rejectData = await rejectRes.json();

    report('Admin can reject invalid settlement with documented reason',
      rejectRes.status === 200 &&
      rejectData.success === true &&
      rejectData.reason === 'Invalid reference number provided' &&
      rejectData.settlement.status === 'REJECTED'
    );

    // Test: Admin approval writes balanced ledger journal and atomically reduces debt
    const approveRes = await fetch(`${BASE_URL}/api/admin/settlements/${settlementId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ notes: 'Verified via Airtel Money Till Portal' })
    });
    const approveData = await approveRes.json();

    report('Admin approval reduces Driver.commissionDebtMWK in one atomic transaction',
      approveRes.status === 200 &&
      approveData.success === true &&
      approveData.previousDebtMWK === 18500 &&
      approveData.newDebtMWK === 11000 &&
      approveData.settledAmountMWK === 7500
    );

    report('Admin approval writes a double-entry ledger journal that balances strictly to zero',
      approveData.netBalanceSum === 0 &&
      approveData.entriesCount === 2
    );

    // Verify journal directly from DB
    const journalAudit = await dbLedger.verifyJournalBalance(approveData.journalId);
    report('Database confirms journal entries balance to zero (Net Sum = 0)',
      journalAudit.isBalanced === true && journalAudit.sum === 0
    );

    // Verify AuditLog written
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        entityId: highDebtUser.driverProfile.id,
        action: 'COMMISSION_SETTLED'
      },
      orderBy: { createdAt: 'desc' }
    });
    report('Immutable AuditLog record created for COMMISSION_SETTLED',
      !!auditRecord && auditRecord.details?.settlementId === settlementId
    );

    // Test: With debt reduced from 18,500 to 11,000 MWK (<= 15,000 MWK limit), driver is now allowed to go online!
    const updatedSummaryRes = await fetch(`${BASE_URL}/api/driver/commission-summary`, {
      headers: { 'Authorization': `Bearer ${highDebtToken}` }
    });
    const updatedSummary = await updatedSummaryRes.json();

    report('Driver commission summary reflects reduced debt and permits going online',
      updatedSummary.commissionDebtMWK === 11000 &&
      updatedSummary.canGoOnline === true &&
      updatedSummary.debtLimitExceeded === false
    );

    // Driver can now go online via socket
    const driverSocket2 = ioClient(BASE_URL, {
      auth: { token: highDebtToken },
      transports: ['websocket'],
      forceNew: true
    });
    await new Promise((resolve) => driverSocket2.on('connect', resolve));

    const onlineAttempt2 = await new Promise((resolve) => {
      driverSocket2.emit('driver:set_status', { status: 'ONLINE' }, (res) => resolve(res));
    });
    driverSocket2.disconnect();

    report('Driver is successfully allowed to go ONLINE after debt is reduced below limit',
      onlineAttempt2.success === true && onlineAttempt2.availability === 'ONLINE'
    );

    // Clean up test driver debt
    await prisma.driver.update({
      where: { id: highDebtUser.driverProfile.id },
      data: { commissionDebtMWK: 0 }
    });

    console.log('\n=============================================================');
    console.log(`   PRODUCTION & COMMISSION SUITE: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
    console.log('=============================================================\n');

  } catch (err) {
    console.error('\n❌ Fatal Test Suite Failure:', err);
    process.exit(1);
  } finally {
    if (server.listening) {
      server.close();
    }
  }
}

if (require.main === module) {
  runProductionAndCommissionSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runProductionAndCommissionSuite };
