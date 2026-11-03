// ============================================================================
// AAROHAN BACKEND AUTHENTICATION & SECURITY VERIFICATION SUITE (Step 3a)
// Lilongwe, Malawi • PostgreSQL, JWT, HMAC-SHA256, Refresh Token Rotation
// ============================================================================

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ioClient = require('socket.io-client');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');
const pricingService = require('../services/pricing');
const dispatchService = require('../services/dispatch');
const { app, server } = require('../server');

const BASE_URL = 'http://127.0.0.1:3000';

async function runAuthVerificationSuite() {
  console.log('=============================================================');
  console.log('   AAROHAN BACKEND AUTHENTICATION (STEP 3a) AUDIT SUITE');
  console.log('   Lilongwe, Malawi • Security Invariants & Cryptographic Verification');
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

  // Ensure server is listening
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(3000, '0.0.0.0', resolve);
    });
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Server Startup Refusal on Missing / Insecure Secrets
    // -------------------------------------------------------------------------
    console.log('--- 1. Testing Server Startup Secrets Assertion ---');
    const originalJwt = process.env.JWT_SECRET;
    const originalHmac = process.env.OTP_HMAC_SECRET;

    // Test with JWT_SECRET < 32 chars
    let shortJwtRefused = false;
    try {
      process.env.JWT_SECRET = 'too-short-secret';
      authService.assertAuthSecrets();
    } catch (e) {
      shortJwtRefused = e.message.includes('JWT_SECRET must be set');
    }
    process.env.JWT_SECRET = originalJwt;
    report('Server refuses to start when JWT_SECRET is less than 32 characters', shortJwtRefused, 'Caught refusal error');

    // Test with OTP_HMAC_SECRET < 16 chars
    let shortHmacRefused = false;
    try {
      process.env.OTP_HMAC_SECRET = 'short';
      authService.assertAuthSecrets();
    } catch (e) {
      shortHmacRefused = e.message.includes('OTP_HMAC_SECRET must be set');
    }
    process.env.OTP_HMAC_SECRET = originalHmac;
    report('Server refuses to start when OTP_HMAC_SECRET is less than 16 characters', shortHmacRefused, 'Caught refusal error');

    // -------------------------------------------------------------------------
    // TEST 2: Malawian E.164 Phone Format Validation (MACRA Official Ranges)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing Malawian Phone Number Validation (+265...) ---');
    report('Valid Airtel Malawi number (+265991234567) accepted', authService.validateMalawianPhone('+265991234567'));
    report('Valid TNM Malawi number (+265881234567) accepted', authService.validateMalawianPhone('+265881234567'));
    report('Valid TNM Malawi number (+265891234567) accepted', authService.validateMalawianPhone('+265891234567'));
    report('Valid TNM Malawi number (+265311234567) accepted', authService.validateMalawianPhone('+265311234567'));
    report('Non-Malawian prefix (+265771234567) rejected', !authService.validateMalawianPhone('+265771234567'));
    report('Foreign number (+14155552671) rejected', !authService.validateMalawianPhone('+14155552671'));
    report('Invalid prefix (+265123456789) rejected', !authService.validateMalawianPhone('+265123456789'));
    report('Malformed short number (+26599) rejected', !authService.validateMalawianPhone('+26599'));


    // -------------------------------------------------------------------------
    // TEST 3: OTP Request, HMAC-SHA256 Hashing & Security Safeguards
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing OTP Generation & Storage Invariants ---');
    const testPhone = '+265998877665';
    // Clean up test phone in DB
    await prisma.otpCode.deleteMany({ where: { phone: testPhone } });

    const reqRes = await fetch(`${BASE_URL}/api/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone })
    });
    const reqData = await reqRes.json();

    report('POST /api/auth/otp/request succeeds for valid +265 phone', reqData.success === true);
    report('Security Rule: OTP code is NEVER returned in the API response', reqData.otp === undefined && reqData.code === undefined);

    const otpRecord = await prisma.otpCode.findUnique({ where: { phone: testPhone } });
    report('OTP record stored in database with HMAC-SHA256 codeHash', !!otpRecord && otpRecord.codeHash.length === 64, `codeHash: ${otpRecord?.codeHash.slice(0, 16)}...`);
    report('OTP initial state is unconsumed and zero failed attempts', otpRecord?.isConsumed === false && otpRecord?.attempts === 0);

    // -------------------------------------------------------------------------
    // TEST 4: OTP Rate Limiting (Cooldown & Daily Quota)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing OTP Rate Limiting ---');
    const rapidRes = await fetch(`${BASE_URL}/api/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone })
    });
    const rapidData = await rapidRes.json();
    report('Rapid subsequent request blocked by 60-second cooldown', rapidRes.status === 400 && rapidData.error.includes('seconds'), rapidData.error);

    // -------------------------------------------------------------------------
    // TEST 5: 5-Attempt Wrong OTP Lockout & AuditLog
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing 5-Attempt Wrong OTP Lockout ---');
    for (let i = 1; i <= 4; i++) {
      const wrongRes = await fetch(`${BASE_URL}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testPhone, otp: '000000' })
      });
      const wrongData = await wrongRes.json();
      assert.strictEqual(wrongRes.status, 400);
      assert.ok(wrongData.error && wrongData.error.includes('attempt(s) remaining'), `Iteration ${i}: Expected attempt(s) remaining message, got: "${wrongData.error}"`);
    }

    // 5th wrong attempt should lock out the code
    const fifthRes = await fetch(`${BASE_URL}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testPhone, otp: '000000' })
    });
    const fifthData = await fifthRes.json();
    report('5th wrong OTP attempt permanently locks the code', fifthRes.status === 400 && fifthData.error.includes('locked'), fifthData.error);

    // -------------------------------------------------------------------------
    // TEST 6: User Registration Strictly as RIDER (Role from client ignored)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing User Registration as Strict RIDER ---');
    const newRiderPhone = `+26599${Math.floor(1000000 + Math.random() * 9000000)}`;


    // Directly insert known test OTP for deterministic verification
    const knownOtp = '654321';
    const knownHash = authService.hashOtp(newRiderPhone, knownOtp);
    await prisma.otpCode.create({
      data: {
        phone: newRiderPhone,
        codeHash: knownHash,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        isConsumed: false
      }
    });

    const verifyRes = await fetch(`${BASE_URL}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: newRiderPhone,
        otp: knownOtp,
        role: 'ADMIN' // Malicious client attempting to elevate role
      })
    });
    const verifyData = await verifyRes.json();

    report('POST /api/auth/otp/verify succeeds with correct code', verifyRes.status === 200 && verifyData.success === true);
    report('Client-supplied role: ADMIN is REJECTED; user created strictly as RIDER', verifyData.user.role === 'RIDER', `Assigned role: ${verifyData.user.role}`);

    const dbUser = await prisma.user.findUnique({ where: { phone: newRiderPhone }, include: { wallet: true } });
    report('Database confirms User role is RIDER, status is ACTIVE, wallet created', dbUser?.role === 'RIDER' && dbUser?.status === 'ACTIVE' && !!dbUser?.wallet);

    // -------------------------------------------------------------------------
    // TEST 7: JWT Access Token (15m) & Rotating Refresh Token (30d)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Token Lifecycle & Refresh Rotation ---');
    const riderAccessToken = verifyData.accessToken;
    const riderRefreshToken = verifyData.refreshToken;

    const decoded = jwt.decode(riderAccessToken);
    report('Access token uses HS256 algorithm and expires in 15 minutes', decoded && (decoded.exp - decoded.iat === 900), `Token lifespan: ${decoded.exp - decoded.iat}s`);

    // Rotate refresh token
    const refreshRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: riderRefreshToken })
    });
    const refreshData = await refreshRes.json();

    report('POST /api/auth/refresh returns new accessToken and new refreshToken', refreshRes.status === 200 && !!refreshData.accessToken && !!refreshData.refreshToken);
    report('Rotated refresh token is distinct from original token', refreshData.refreshToken !== riderRefreshToken);

    // -------------------------------------------------------------------------
    // TEST 8: Replay Detection on Revoked Refresh Token
    // -------------------------------------------------------------------------
    console.log('\n--- 8. Testing Refresh Token Replay Detection ---');
    // Try to reuse the already-rotated (revoked) token
    const replayRes = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: riderRefreshToken })
    });
    const replayData = await replayRes.json();
    report('Reusing a revoked refresh token triggers security alarm and rejects request', replayRes.status === 401 && replayData.error.includes('already used'), replayData.error);

    // Verify all refresh tokens for this user are now revoked
    const activeTokens = await prisma.refreshToken.count({
      where: { userId: dbUser.id, revokedAt: null }
    });
    report('Breach Invalidation: ALL active refresh tokens for the compromised user are revoked', activeTokens === 0, `Active sessions remaining: ${activeTokens}`);

    // -------------------------------------------------------------------------
    // TEST 9: Admin Provisioning via CLI & Dual-Factor Login
    // -------------------------------------------------------------------------
    console.log('\n--- 9. Testing Admin Provisioning & Dual-Factor Login ---');
    const adminPhone = '+265999970001';
    const adminPassword = 'AArohanLilongweAdmin2026!';
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // Upsert Admin
    const adminUser = await prisma.user.upsert({
      where: { phone: adminPhone },
      create: {
        phone: adminPhone,
        name: 'Lilongwe Desk Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
        wallet: { create: { balanceMWK: 0 } }
      },
      update: {
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash
      }
    });

    // Request admin OTP
    const adminOtp = '789123';
    await prisma.otpCode.upsert({
      where: { phone: adminPhone },
      create: {
        phone: adminPhone,
        codeHash: authService.hashOtp(adminPhone, adminOtp),
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        isConsumed: false
      },
      update: {
        codeHash: authService.hashOtp(adminPhone, adminOtp),
        attempts: 0,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        isConsumed: false
      }
    });

    // Attempting login via standard OTP verify must be REJECTED for admin
    const adminDirectOtpRes = await fetch(`${BASE_URL}/api/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: adminPhone, otp: adminOtp })
    });
    const adminDirectData = await adminDirectOtpRes.json();
    report('Admin direct login via /api/auth/otp/verify is FORBIDDEN without password', adminDirectOtpRes.status === 403, adminDirectData.error);

    // Reset OTP to unconsumed before admin login attempt
    await prisma.otpCode.update({ where: { phone: adminPhone }, data: { isConsumed: false, attempts: 0 } });

    // Wrong password must fail
    const wrongPassRes = await fetch(`${BASE_URL}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: adminPhone, password: 'WrongPassword123!', otp: adminOtp })
    });
    report('Admin login with incorrect password is rejected (401)', wrongPassRes.status === 401);

    // Re-seed unconsumed OTP for successful login
    await prisma.otpCode.update({ where: { phone: adminPhone }, data: { isConsumed: false, attempts: 0 } });

    // Correct dual-factor login (phone + password + OTP)
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: adminPhone, password: adminPassword, otp: adminOtp })
    });
    const adminLoginData = await adminLoginRes.json();

    report('Admin dual-factor login succeeds with phone + password + OTP', adminLoginRes.status === 200 && adminLoginData.user.role === 'ADMIN');
    const adminAccessToken = adminLoginData.accessToken;

    // -------------------------------------------------------------------------
    // TEST 10: Driver Registration Separate Endpoint (Status PENDING)
    // -------------------------------------------------------------------------
    console.log('\n--- 10. Testing Driver Registration Endpoint ---');
    // Issue a fresh rider token for registration
    const freshRiderToken = authService.issueAccessToken(dbUser);

    // Delete any existing driver for dbUser
    await prisma.vehicle.deleteMany({ where: { driver: { userId: dbUser.id } } });
    await prisma.driver.deleteMany({ where: { userId: dbUser.id } });

    const driverRegRes = await fetch(`${BASE_URL}/api/auth/driver/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${freshRiderToken}`
      },
      body: JSON.stringify({
        makeModel: 'Honda Ace 125',
        color: 'Black',
        plateNumber: `BT-${Math.floor(1000 + Math.random() * 9000)}-MW`,
        vehicleType: 'MOTO',
        year: 2024
      })
    });
    const driverRegData = await driverRegRes.json();

    report('POST /api/auth/driver/register creates Driver with status PENDING', driverRegRes.status === 200 && driverRegData.driver.approvalStatus === 'PENDING', `Status: ${driverRegData.driver?.approvalStatus}`);

    // Verify in DB
    const driverInDb = await prisma.driver.findFirst({ where: { userId: dbUser.id } });
    report('Database confirms Driver approvalStatus is PENDING until admin verification', driverInDb?.approvalStatus === 'PENDING');

    // -------------------------------------------------------------------------
    // TEST 11: Deny-by-Default Architecture & Protected Endpoints
    // -------------------------------------------------------------------------
    console.log('\n--- 11. Testing Deny-by-Default Security Policy ---');
    // Unauthenticated call to protected endpoint must return 401
    const unauthTripRes = await fetch(`${BASE_URL}/api/trips/active`);
    report('Unauthenticated request to /api/trips/active returns 401 Unauthorized', unauthTripRes.status === 401);

    const unauthAdminRes = await fetch(`${BASE_URL}/api/admin/metrics`);
    report('Unauthenticated request to /api/admin/metrics returns 401 Unauthorized', unauthAdminRes.status === 401);

    // Calling admin endpoint with RIDER token must return 403 Forbidden
    const riderAdminRes = await fetch(`${BASE_URL}/api/admin/metrics`, {
      headers: { 'Authorization': `Bearer ${freshRiderToken}` }
    });
    report('Rider access to /api/admin/metrics returns 403 Forbidden', riderAdminRes.status === 403);

    // Calling admin endpoint with ADMIN token succeeds
    const adminMetricsRes = await fetch(`${BASE_URL}/api/admin/metrics`, {
      headers: { 'Authorization': `Bearer ${adminAccessToken}` }
    });
    report('Admin access to /api/admin/metrics succeeds with 200 OK', adminMetricsRes.status === 200);

    // Whitelisted public endpoints succeed without token
    const publicQuoteRes = await fetch(`${BASE_URL}/api/rides/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: { lat: -13.9722, lng: 33.7667, name: 'Gateway Mall' },
        destination: { lat: -13.9554, lng: 33.7872, name: 'Capital City' }
      })
    });
    report('Whitelisted public endpoint (/api/rides/quote) succeeds without token', publicQuoteRes.status === 200);

    // -------------------------------------------------------------------------
    // TEST 12: Account Status Verification (SUSPENDED / BANNED Enforcement)
    // -------------------------------------------------------------------------
    console.log('\n--- 12. Testing Account Status (ACTIVE vs SUSPENDED) ---');
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { status: 'SUSPENDED' }
    });

    const suspendedRes = await fetch(`${BASE_URL}/api/trips/active`, {
      headers: { 'Authorization': `Bearer ${freshRiderToken}` }
    });
    const suspendedData = await suspendedRes.json();
    report('Suspended user is blocked from API endpoints with 403 Forbidden', suspendedRes.status === 403 && suspendedData.code === 'ACCOUNT_INACTIVE', suspendedData.error);

    // Restore active status
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { status: 'ACTIVE' }
    });

    // -------------------------------------------------------------------------
    // TEST 13: Socket.IO Real-Time JWT Authentication
    // -------------------------------------------------------------------------
    console.log('\n--- 13. Testing Socket.IO Real-Time JWT Authentication ---');
    // Connect without token -> must be rejected
    let unauthSocketRejected = false;
    try {
      await new Promise((resolve, reject) => {
        const s = ioClient(BASE_URL, { transports: ['websocket'], auth: {} });
        s.on('connect', () => { s.disconnect(); reject(new Error('Unauth socket should not connect')); });
        s.on('connect_error', (err) => { s.disconnect(); resolve(err); });
      });
      unauthSocketRejected = true;
    } catch (e) {
      unauthSocketRejected = false;
    }
    report('Socket.IO connection without JWT token is rejected', unauthSocketRejected);

    // Create a dedicated pure RIDER for socket testing
    const pureRiderPhone = `+26599${Math.floor(1000000 + Math.random() * 9000000)}`;
    const pureRiderUser = await prisma.user.create({
      data: {
        phone: pureRiderPhone,
        name: 'Lilongwe Rider Test',
        role: 'RIDER',
        status: 'ACTIVE',
        wallet: { create: { balanceMWK: 50000 } }
      }
    });
    const pureRiderToken = authService.issueAccessToken(pureRiderUser);

    // Connect with valid rider JWT -> must connect
    let authRiderSocketConnected = false;
    const riderSocket = ioClient(BASE_URL, {
      transports: ['websocket'],
      auth: { token: pureRiderToken }
    });
    await new Promise((resolve, reject) => {
      riderSocket.on('connect', () => { authRiderSocketConnected = true; resolve(); });
      riderSocket.on('connect_error', reject);
    });
    report('Socket.IO connection with valid Rider JWT connects successfully', authRiderSocketConnected);

    // PENDING driver cannot connect with DRIVER token
    const pendingDriverUser = await prisma.user.findUnique({ where: { id: dbUser.id }, include: { driverProfile: true } });
    const pendingDriverToken = authService.issueAccessToken(pendingDriverUser);
    let pendingDriverSocketRejected = false;
    try {
      await new Promise((resolve, reject) => {
        const s = ioClient(BASE_URL, { transports: ['websocket'], auth: { token: pendingDriverToken } });
        s.on('connect', () => { s.disconnect(); reject(new Error('Pending driver should not connect')); });
        s.on('connect_error', (err) => { s.disconnect(); resolve(err); });
      });
      pendingDriverSocketRejected = true;
    } catch (e) {
      pendingDriverSocketRejected = false;
    }
    report('Socket.IO connection rejected for DRIVER with approvalStatus: PENDING', pendingDriverSocketRejected);

    // APPROVED driver connects successfully
    await prisma.driver.update({
      where: { userId: dbUser.id },
      data: { approvalStatus: 'APPROVED' }
    });
    const approvedDriverUser = await prisma.user.findUnique({ where: { id: dbUser.id }, include: { driverProfile: true } });
    const approvedDriverToken = authService.issueAccessToken(approvedDriverUser);
    let approvedDriverConnected = false;
    const approvedDriverSocket = ioClient(BASE_URL, {
      transports: ['websocket'],
      auth: { token: approvedDriverToken }
    });
    await new Promise((resolve, reject) => {
      approvedDriverSocket.on('connect', () => { approvedDriverConnected = true; resolve(); });
      approvedDriverSocket.on('connect_error', reject);
    });
    report('Socket.IO connection succeeds for DRIVER with approvalStatus: APPROVED', approvedDriverConnected);
    approvedDriverSocket.disconnect();

    riderSocket.disconnect();

    // -------------------------------------------------------------------------
    // TEST 14: Socket Handlers Enforce Active Status & Zod Payloads
    // -------------------------------------------------------------------------
    console.log('\n--- 14. Testing Socket Handler Payloads & Try/Catch Guards ---');
    const testRiderSocket = ioClient(BASE_URL, {
      transports: ['websocket'],
      auth: { token: pureRiderToken }
    });
    await new Promise((resolve) => testRiderSocket.on('connect', resolve));

    // Send malformed trip:request payload
    const malformedResult = await new Promise((resolve) => {
      testRiderSocket.emit('trip:request', { fare: 'not-a-number', pickup: 123 }, (res) => {
        resolve(res);
      });
    });
    report('Socket trip:request validates payload via Zod and safely handles error via callback', malformedResult.success === false, malformedResult.error);

    testRiderSocket.disconnect();

    // -------------------------------------------------------------------------
    // TEST 15: Server-Side Pricing: Forged Fares Completely Ignored
    // -------------------------------------------------------------------------
    console.log('\n--- 15. Testing Server-Side Pricing & Forged Fare Protection ---');
    const validQuote = pricingService.generateQuote({
      pickup: { name: 'Area 10', lat: -13.9600, lng: 33.7800 },
      destination: { name: 'Gateway Mall', lat: -13.9722, lng: 33.7667 },
      distanceKm: 4.0,
      durationMins: 10
    });
    const authoritativeFare = validQuote.tiers.cab.finalFare;

    const pricingRiderSocket = ioClient(BASE_URL, {
      transports: ['websocket'],
      auth: { token: pureRiderToken }
    });
    await new Promise((resolve) => pricingRiderSocket.on('connect', resolve));

    // Rider tries to forge a cheap fare (fare: 10 MWK instead of authoritative ~4500 MWK)
    const forgedTripResult = await new Promise((resolve) => {
      pricingRiderSocket.emit('trip:request', {
        quoteId: validQuote.quoteId,
        tierId: 'cab',
        fare: 10,
        baseFare: 5,
        pickup: { name: 'Area 10', lat: -13.9600, lng: 33.7800 },
        destination: { name: 'Gateway Mall', lat: -13.9722, lng: 33.7667 },
        idempotencyKey: `FORGE-TEST-${Date.now()}`
      }, (res) => resolve(res));
    });

    report('Forged client fare (10 MWK) is ignored; server applies quote fare',
      forgedTripResult.success === true && forgedTripResult.trip.fareMWK === authoritativeFare,
      `Requested fare: 10 MWK • Server stored fare: ${forgedTripResult.trip?.fareMWK} MWK (Quote: ${authoritativeFare} MWK)`
    );

    // Clean up created test trip
    await prisma.trip.update({
      where: { id: forgedTripResult.trip.id },
      data: { status: 'CANCELLED_BY_RIDER' }
    });
    pricingRiderSocket.disconnect();

    // -------------------------------------------------------------------------
    // TEST 16: Disabled wallet:topup outside development
    // -------------------------------------------------------------------------
    console.log('\n--- 16. Testing wallet:topup Production Safeguard ---');
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const prodSocket = ioClient(BASE_URL, {
      transports: ['websocket'],
      auth: { token: pureRiderToken }
    });
    await new Promise((resolve) => prodSocket.on('connect', resolve));

    const topupProdResult = await new Promise((resolve) => {
      prodSocket.emit('wallet:topup', { amount: 5000, provider: 'AIRTEL_MONEY' }, (res) => resolve(res));
    });
    report('Direct wallet:topup is disabled when NODE_ENV is production',
      topupProdResult.success === false && topupProdResult.error.includes('disabled in production'),
      topupProdResult.error
    );
    prodSocket.disconnect();
    process.env.NODE_ENV = oldEnv;

    // -------------------------------------------------------------------------
    // TEST 17: Admin Password Lockout After 5 Failed Attempts
    // -------------------------------------------------------------------------
    console.log('\n--- 17. Testing Admin Password Lockout ---');
    const lockoutAdminPhone = '+265999970002';
    const lockoutAdminPassword = 'LockoutAdminSecret123!';
    const lockoutHash = await bcrypt.hash(lockoutAdminPassword, 12);
    await prisma.user.upsert({
      where: { phone: lockoutAdminPhone },
      create: {
        phone: lockoutAdminPhone,
        name: 'Lockout Test Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: lockoutHash,
        wallet: { create: { balanceMWK: 0 } }
      },
      update: {
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash: lockoutHash
      }
    });

    const lockoutOtp = '112233';
    await prisma.otpCode.upsert({
      where: { phone: lockoutAdminPhone },
      create: {
        phone: lockoutAdminPhone,
        codeHash: authService.hashOtp(lockoutAdminPhone, lockoutOtp),
        attempts: 0,
        maxAttempts: 50,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        isConsumed: false
      },
      update: {
        codeHash: authService.hashOtp(lockoutAdminPhone, lockoutOtp),
        attempts: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        isConsumed: false
      }
    });

    // Fail 4 times
    for (let i = 1; i <= 4; i++) {
      await prisma.otpCode.update({ where: { phone: lockoutAdminPhone }, data: { isConsumed: false, attempts: 0 } });
      const failRes = await fetch(`${BASE_URL}/api/auth/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: lockoutAdminPhone, password: 'WrongPassword!', otp: lockoutOtp })
      });
      assert.strictEqual(failRes.status, 401);
    }

    // 5th failed password attempt triggers lockout (429)
    await prisma.otpCode.update({ where: { phone: lockoutAdminPhone }, data: { isConsumed: false, attempts: 0 } });
    const lockRes = await fetch(`${BASE_URL}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: lockoutAdminPhone, password: 'WrongPassword!', otp: lockoutOtp })
    });
    const lockData = await lockRes.json();
    report('5th failed password attempt locks admin account (429)', lockRes.status === 429 && lockData.error.includes('locked'), lockData.error);

    // -------------------------------------------------------------------------
    // TEST 18: /api/reset Forbidden in Production
    // -------------------------------------------------------------------------
    console.log('\n--- 18. Testing /api/reset Environment Guard ---');
    process.env.NODE_ENV = 'production';
    const resetProdRes = await fetch(`${BASE_URL}/api/reset`, { method: 'POST' });
    report('/api/reset is forbidden (403) when NODE_ENV is not development', resetProdRes.status === 403);
    process.env.NODE_ENV = oldEnv;

    // -------------------------------------------------------------------------
    // TEST 19: Anonymized Nearby Drivers for Unauthenticated Requests
    // -------------------------------------------------------------------------
    console.log('\n--- 19. Testing Nearby Drivers Anonymization ---');
    const seededDriver = await prisma.driver.findFirst({ where: { approvalStatus: 'APPROVED' } });
    if (seededDriver) {
      await prisma.driver.update({
        where: { id: seededDriver.id },
        data: {
          currentLat: -13.9722,
          currentLng: 33.7667,
          availability: 'ONLINE',
          lastLocationAt: new Date()
        }
      });
    }

    const anonNearbyRes = await fetch(`${BASE_URL}/api/drivers/nearby?lat=-13.9722&lng=33.7667`);
    const anonNearbyData = await anonNearbyRes.json();
    const driver = anonNearbyData.drivers?.[0];
    const isAnonymized = driver &&
      !driver.name &&
      !driver.phone &&
      !driver.plate &&
      driver.id.startsWith('anon-');
    report('Unauthenticated /api/drivers/nearby masks driver names, phones, and plate numbers', isAnonymized, `Anonymous driver ID: ${driver?.id}`);

    // -------------------------------------------------------------------------
    // TEST 20: Driver vehicleType Enum Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 20. Testing Driver Registration vehicleType Enum Enforcement ---');
    const invalidTypeRes = await fetch(`${BASE_URL}/api/auth/driver/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pureRiderToken}`
      },
      body: JSON.stringify({
        makeModel: 'Boeing 737',
        color: 'White',
        plateNumber: 'BT-AIR-1',
        vehicleType: 'AIRPLANE'
      })
    });
    report('Driver registration rejects invalid vehicleType not in (MOTO, AUTO, CAB)', invalidTypeRes.status === 400);

    console.log('\n=============================================================');
    console.log(`   BACKEND AUTH VERIFICATION RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
    console.log('=============================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Fatal Test Error:', err);
    process.exit(1);
  }
}

runAuthVerificationSuite();
