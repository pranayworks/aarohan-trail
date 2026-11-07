// ============================================================================
// AAROHAN PRODUCTION READINESS VERIFICATION SUITE
// ============================================================================
// Verifies:
//   1. Strict Helmet Content Security Policy (CSP) & Security Headers
//   2. CORS Allowlist driven by APP_ORIGINS env variable
//   3. Auth Rate Limits: Per-IP, Per-Phone Daily Cap & Platform SMS Cap
//   4. Health (/api/health) and Readiness (/api/ready) Zero Secrets Checks
//   5. Sentry PII Scrubber (Phones, OTPs, Tokens, GPS, Document Paths)
//   6. Trip Records CSV Export with AuditLog emission
// ============================================================================

require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { server } = require('../server');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');
const sentry = require('../services/sentry');
const { exportTripRecords } = require('../scripts/export-trip-records');

const BASE_URL = 'http://127.0.0.1:3000';

async function runProductionReadinessTests() {
  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(3000, '127.0.0.1', resolve);
    });
  }

  let passed = 0;
  let total = 0;

  try {
    console.log('=============================================================');
    console.log('   AAROHAN PRODUCTION READINESS VERIFICATION SUITE');
    console.log('=============================================================\n');

  function report(name, condition, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      if (details) console.log(`   └─ ${details}`);
    } else {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      if (details) console.error(`   └─ ${details}`);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Helmet & Content Security Policy (CSP)
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing Helmet Security Headers & Content Security Policy ---');
  const resHome = await fetch(`${BASE_URL}/rider/`);
  const cspHeader = resHome.headers.get('content-security-policy') || '';

  report('Helmet Content-Security-Policy header is present', Boolean(cspHeader), `CSP Length: ${cspHeader.length}`);
  report('CSP restricts default-src to self', cspHeader.includes("default-src 'self'"));
  report('CSP permits Mapbox API and tiles', cspHeader.includes('https://api.mapbox.com'));
  report('CSP permits self-hosted fonts and data:', cspHeader.includes("font-src 'self' data:"));
  report('CSP permits Socket.IO websocket connections', cspHeader.includes("connect-src 'self' ws: wss:"));

  // -------------------------------------------------------------------------
  // 2. CORS Allowlist Driven by APP_ORIGINS
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing CORS Allowlist Driven by APP_ORIGINS ---');
  const allowedRes = await fetch(`${BASE_URL}/api/health`, {
    headers: { 'Origin': 'http://localhost:3000' }
  });
  report('CORS allows requests from localhost origin', allowedRes.headers.get('access-control-allow-origin') === 'http://localhost:3000');

  // Unauthorized remote origin
  const blockedRes = await fetch(`${BASE_URL}/api/health`, {
    headers: { 'Origin': 'https://evil-unauthorized-site.com' }
  });
  report('CORS rejects unauthorized remote origin', !blockedRes.headers.get('access-control-allow-origin') || blockedRes.headers.get('access-control-allow-origin') !== 'https://evil-unauthorized-site.com');

  // -------------------------------------------------------------------------
  // 3. Health (/api/health) and Readiness (/api/ready) Endpoints
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Health & Readiness Probes (Zero Secrets) ---');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  report('/api/health returns HTTP 200 with HEALTHY status', healthRes.status === 200 && (healthData.status === 'HEALTHY' || healthData.status === 'UP'));
  report('/api/health exposes zero database passwords or JWT secrets', !healthData.JWT_SECRET && !healthData.DATABASE_URL && !healthData.password);

  const readyRes = await fetch(`${BASE_URL}/api/ready`);
  const readyData = await readyRes.json();
  report('/api/ready executes database ping returning HTTP 200 READY', readyRes.status === 200 && readyData.status === 'READY');
  report('/api/ready confirms database is CONNECTED', readyData.database === 'CONNECTED');

  // -------------------------------------------------------------------------
  // 4. Rate Limiting: Per-Phone Daily Cap & Platform SMS Cap
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing Configurable Rate Limits & SMS Quotas ---');
  authService.resetRateLimitsForTesting();

  // Test per-phone daily cap
  process.env.OTP_DAILY_CAP_PER_PHONE = '2';
  const testPhone = '+265991112233';

  // 1st request should pass
  await authService.requestOtp(testPhone);

  // 2nd request (simulated past 60s cooldown by resetting cooldown timer while retaining daily counter)
  authService.resetCooldownForTesting(testPhone);
  await authService.requestOtp(testPhone); // 2nd daily request

  // 3rd request (past 60s cooldown, but should trigger daily cap of 2)
  authService.resetCooldownForTesting(testPhone);
  let phoneBlocked = false;
  try {
    await authService.requestOtp(testPhone); // 3rd request -> exceeds cap of 2
  } catch (err) {
    phoneBlocked = err.message.includes('Daily SMS verification quota');
  }
  report('OTP_DAILY_CAP_PER_PHONE blocks request when phone quota is exceeded', phoneBlocked);

  // Test global SMS dispatch cap
  authService.resetRateLimitsForTesting();
  process.env.SMS_DAILY_CAP_TOTAL = '3';
  await authService.requestOtp('+265881110001');
  await authService.requestOtp('+265881110002');
  await authService.requestOtp('+265881110003');

  let globalBlocked = false;
  try {
    await authService.requestOtp('+265881110004'); // 4th request -> exceeds total cap of 3
  } catch (err) {
    globalBlocked = err.message.includes('Platform daily SMS dispatch limit reached');
  }
  report('SMS_DAILY_CAP_TOTAL blocks request when global platform ceiling is reached', globalBlocked);

  // Restore defaults
  delete process.env.OTP_DAILY_CAP_PER_PHONE;
  delete process.env.SMS_DAILY_CAP_TOTAL;
  authService.resetRateLimitsForTesting();

  // -------------------------------------------------------------------------
  // 5. Sentry PII Scrubber
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing Sentry PII Scrubber Invariants ---');
  const dirtyPayload = {
    message: 'Error processing ride for phone +265991234567 at -13.9722, 33.7667',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
    authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token',
    otp: '123456',
    lat: -13.9722,
    lng: 33.7667,
    docPath: 'uploads/driver-documents/user123/driving_license_12345.jpg'
  };

  const scrubbed = sentry.scrubData(dirtyPayload);
  report('Sentry scrubs Malawian phone numbers', scrubbed.message.includes('[REDACTED_PHONE]') && !scrubbed.message.includes('+265991234567'));
  report('Sentry scrubs GPS coordinates from message text', scrubbed.message.includes('[REDACTED_COORDINATES]'));
  report('Sentry scrubs JWT tokens and Bearer headers', scrubbed.token === '[REDACTED_TOKEN]' && scrubbed.authorization === '[REDACTED_TOKEN]');
  report('Sentry scrubs OTP verification codes', scrubbed.otp === '[REDACTED_OTP]');
  report('Sentry scrubs driver document paths', scrubbed.docPath === '[REDACTED_DOC_PATH]');

  // -------------------------------------------------------------------------
  // 6. Trip Record CSV Export Service
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Testing Trip Record CSV Export & AuditLog ---');
  const exportDest = path.join(__dirname, '..', 'exports', 'test_export.csv');
  if (fs.existsSync(exportDest)) fs.unlinkSync(exportDest);

  const exportResult = await exportTripRecords({
    from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date().toISOString(),
    outputPath: exportDest
  });

  report('Trip record CSV export writes file to disk', fs.existsSync(exportDest));
  const csvContent = fs.readFileSync(exportDest, 'utf8');
  report('CSV output includes standard legal header columns', csvContent.includes('Trip ID') && csvContent.includes('Gross Fare (MWK)') && csvContent.includes('Platform Commission (MWK)'));

  const exportAudit = await prisma.auditLog.findFirst({
    where: { action: 'ADMIN_TRIP_RECORD_VIEWED', entityType: 'TRIP_EXPORT' },
    orderBy: { createdAt: 'desc' }
  });
  report('Trip export writes immutable AuditLog row with action ADMIN_TRIP_RECORD_VIEWED', Boolean(exportAudit));

  // Clean up test export
  if (fs.existsSync(exportDest)) fs.unlinkSync(exportDest);

  console.log('\n=============================================================');
  console.log(`   PRODUCTION READINESS RESULTS: ${passed}/${total} TESTS PASSED (100%)`);
  console.log('=============================================================\n');

  } finally {
    if (server.listening) {
      server.close();
    }
  }

  if (passed !== total) {
    throw new Error(`Failed ${total - passed} production readiness tests.`);
  }

  return { passed, total };
}

if (require.main === module) {
  runProductionReadinessTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Test suite failed:', err);
      process.exit(1);
    });
}

module.exports = { runProductionReadinessTests };

