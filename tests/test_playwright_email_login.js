// ============================================================================
// AAROHAN PLAYWRIGHT EMAIL-LOGIN TEST (AUTH_MODE=email)
// Checks the real screens in a real browser:
//   1. the login box asks for an EMAIL (not a phone number) and blocks without the consent tick
//   2. a code is "emailed" (captured in-process, nothing is really sent) and entered
//   3. a first-time person is asked for name + mobile number, then signs in
//   4. explicit consent is recorded in the database
//   5. the phone-code route answers 404 while email mode is on
// Run on its own:  npm run test:playwright:email   (stop other servers / test runs first)
// ============================================================================

process.env.AUTH_MODE = 'email';
process.env.EMAIL_PROVIDER = 'simulator';
require('dotenv').config();
process.env.AUTH_MODE = 'email'; // .env must not switch it back for this test

const assert = require('assert');
const { chromium } = require('playwright');
const prisma = require('../lib/prisma');
const emailService = require('../services/email');
const { server } = require('../server');

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'playwright.email.demo@aarohan.test';
const TEST_NAME = 'Email Demo Rider';
const TEST_PHONE_INPUT = '0880000111'; // becomes +265880000111

(async function run() {
  console.log('=============================================================');
  console.log('   AAROHAN PLAYWRIGHT EMAIL-LOGIN VERIFICATION');
  console.log('=============================================================\n');

  if (server.listening) throw new Error('A server is already running in this process.');
  await new Promise((resolve, reject) => {
    server.once('error', (err) => reject(err.code === 'EADDRINUSE'
      ? new Error('Port 3000 is already in use. Stop any other server or test run first, then run this test on its own.')
      : err));
    server.listen(3000, '0.0.0.0', resolve);
  });

  // Capture the code instead of sending an email
  const sent = [];
  emailService.sendOtpEmail = async ({ to, code }) => { sent.push({ to, code }); return { provider: 'test' }; };

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 420, height: 850 },
    geolocation: { latitude: -13.9722, longitude: 33.7667 },
    permissions: ['geolocation']
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`  [Browser error] ${e.message}`));
  page.on('dialog', (d) => d.accept());

  let ok = false;
  try {
    console.log('--- Step 1: the login box asks for an email ---');
    await page.goto(`${BASE_URL}/rider/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#auth-email-input', { state: 'visible', timeout: 15000 });
    assert.strictEqual(await page.locator('#auth-phone-input').count(), 0, 'Email mode must not show the phone box');
    console.log('  [PASS] The email box is shown (no phone box)');

    await page.locator('#auth-email-input').fill(TEST_EMAIL.toUpperCase());
    await page.locator('#auth-phone-submit').click();
    await page.waitForTimeout(800);
    assert.strictEqual(sent.length, 0, 'No code may be sent before the consent box is ticked');
    console.log('  [PASS] Without the consent tick, no code is sent');

    console.log('\n--- Step 2: tick consent, request the code, enter it ---');
    await page.locator('#auth-consent').check();
    await page.locator('#auth-phone-submit').click();
    await page.waitForSelector('#auth-otp-input', { state: 'visible', timeout: 15000 });
    assert.strictEqual(sent.length, 1, 'Exactly one code should have been sent');
    assert.strictEqual(sent[0].to, TEST_EMAIL, 'The email must be normalised to lower case');
    console.log('  [PASS] A code was "emailed" to the normalised address');

    await page.locator('#auth-otp-input').fill(sent[0].code);
    await page.locator('#auth-otp-submit').click();

    console.log('\n--- Step 3: first-time details (only if this email is new) ---');
    const profileShown = await page.locator('#auth-profile-fields').waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
    if (profileShown) {
      await page.locator('#auth-profile-name').fill(TEST_NAME);
      await page.locator('#auth-profile-phone').fill(TEST_PHONE_INPUT);
      await page.locator('#auth-otp-submit').click();
      console.log('  [PASS] A new person is asked for name and mobile number, then continues');
    } else {
      console.log('  [INFO] This email already has an account from an earlier run: signed in directly');
    }

    await page.waitForSelector('#aarohan-auth-modal', { state: 'detached', timeout: 20000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aarohan_user') || '{}'));
    assert.strictEqual(stored.email, TEST_EMAIL, 'The signed-in user must carry the email');
    assert.strictEqual(stored.role, 'RIDER', 'Email signups are always riders');
    console.log('  [PASS] Signed in as a rider with the email identity');

    console.log('\n--- Step 4: explicit consent is recorded ---');
    let docs = [];
    for (let i = 0; i < 10 && docs.length < 2; i++) {
      await page.waitForTimeout(700);
      docs = (await prisma.consentRecord.findMany({ where: { userId: stored.id }, select: { documentType: true } })).map((r) => r.documentType);
    }
    assert.ok(docs.includes('TERMS_OF_SERVICE') && docs.includes('PRIVACY_POLICY'), `Consent records missing (found: ${docs.join(', ') || 'none'})`);
    console.log('  [PASS] Terms and Privacy consent recorded in the database');

    console.log('\n--- Step 5: the phone-code route is closed in email mode ---');
    const status = await page.evaluate(() => fetch('/api/auth/otp/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+265991234567' })
    }).then((r) => r.status));
    assert.strictEqual(status, 404, 'Phone login must answer 404 in email mode');
    console.log('  [PASS] /api/auth/otp/request answers 404');

    ok = true;
  } catch (err) {
    console.error('\n[FAILURE]', err.message);
    try { await page.screenshot({ path: 'docs/screenshots/playwright-failure-email.png' }); } catch (_) {}
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await prisma.$disconnect().catch(() => {});
  }

  console.log('\n=============================================================');
  console.log(ok ? '   🎉 EMAIL LOGIN BROWSER FLOW: ALL STEPS PASSED' : '   ❌ EMAIL LOGIN BROWSER FLOW: FAILED');
  console.log('=============================================================\n');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('[FATAL]', e.message); process.exit(1); });
