'use strict';
// ============================================================================
// AAROHAN EMAIL LOGIN SUITE (no database, no network): AUTH_MODE=email
// Runs the real email-login, email-sender and config-validator code against a fake
// in-memory data layer, with the email provider and `fetch` stubbed.
// ============================================================================

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.OTP_HMAC_SECRET = 'test-otp-hmac-secret-16plus';
process.env.AUTH_MODE = 'email';
process.env.EMAIL_PROVIDER = 'simulator';
delete process.env.EMAIL_DAILY_CAP_TOTAL;
delete process.env.OTP_DAILY_CAP_PER_PHONE;

let passed = 0, total = 0;
function report(name, ok, detail = '') {
  total++;
  if (ok) { passed++; console.log(`✅ [PASS] ${name}`); }
  else console.log(`❌ [FAIL] ${name}${detail ? '  ::  ' + detail : ''}`);
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ----------------------------- fake data layer ------------------------------
const db = { otps: new Map(), users: [], wallets: [], audit: [], refresh: [] };
let seq = 0;
const adminHash = bcrypt.hashSync('S3cure-Admin-Pass', 4);
db.users.push({ id: 'U-ADMIN', email: 'boss@aarohan.test', phone: '+265990000001', name: 'Boss', role: 'ADMIN', status: 'ACTIVE', passwordHash: adminHash });
db.users.push({ id: 'U-EXIST', email: 'rita@example.com', phone: '+265991111111', name: 'Rita', role: 'RIDER', status: 'ACTIVE', passwordHash: null });
db.users.push({ id: 'U-SUSP', email: 'sam@example.com', phone: '+265992222222', name: 'Sam', role: 'RIDER', status: 'SUSPENDED', passwordHash: null });
db.users.push({ id: 'U-TAKEN', email: null, phone: '+265993333333', name: 'Taken', role: 'RIDER', status: 'ACTIVE', passwordHash: null });

const fakePrisma = {
  emailOtp: {
    findUnique: async ({ where }) => (db.otps.has(where.email) ? { ...db.otps.get(where.email) } : null),
    upsert: async ({ where, create, update }) => {
      const cur = db.otps.get(where.email);
      db.otps.set(where.email, cur ? { ...cur, ...update } : { ...create });
      return db.otps.get(where.email);
    },
    update: async ({ where, data }) => { Object.assign(db.otps.get(where.email), data); return db.otps.get(where.email); },
    updateMany: async ({ where, data }) => {
      const r = db.otps.get(where.email);
      if (!r || r.isConsumed !== where.isConsumed) return { count: 0 };
      Object.assign(r, data); return { count: 1 };
    }
  },
  user: {
    findFirst: async ({ where }) => { const u = db.users.find((x) => x.email === where.email); return u ? { ...u, driverProfile: null, wallet: null } : null; },
    findUnique: async ({ where }) => { const u = db.users.find((x) => x.phone === where.phone); return u ? { ...u } : null; },
    create: async ({ data }) => { const u = { id: 'U-NEW-' + (++seq), passwordHash: null, ...data }; db.users.push(u); return { ...u, driverProfile: null, wallet: null }; }
  },
  wallet: { create: async ({ data }) => { db.wallets.push(data); return data; } },
  auditLog: { create: async ({ data }) => { db.audit.push(data); return data; } },
  refreshToken: { create: async ({ data }) => { db.refresh.push(data); return data; } }
};
const prismaPath = require.resolve('../lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: fakePrisma };

const emailService = require('../services/email');
const emailAuth = require('../services/emailAuth');
const { validateStartupConfig } = require('../services/configValidator');
const featureFlags = require('../services/featureFlags');
const authService = require('../services/auth');

// Capture codes instead of sending
let sent = [];
let failSend = false;
const realSendOtpEmail = emailService.sendOtpEmail;
emailService.sendOtpEmail = async ({ to, code }) => {
  if (failSend) throw new Error('provider down');
  sent.push({ to, code });
  return { provider: 'test' };
};
const lastCode = () => sent[sent.length - 1].code;

// Time travel for the 60-second cooldown
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const advance = (ms) => { offset += ms; };
const errOf = async (p) => { try { await p; return null; } catch (e) { return e; } };

(async function main() {
  console.log('=============================================================');
  console.log('   AAROHAN EMAIL LOGIN SUITE (no database required)');
  console.log('=============================================================');

  console.log('\n--- 1. Input handling ---');
  report('Emails are trimmed and lower-cased', emailAuth.normalizeEmail('  Pranay@Example.COM ') === 'pranay@example.com');
  report('Bad emails are rejected', ['', 'abc', 'a@b', 'a b@c.com', null, 42, 'x'.repeat(260) + '@a.com'].every((e) => emailAuth.normalizeEmail(e) === null));
  report('Malawian numbers are normalised from common formats',
    emailAuth.normalizeMalawiPhone('99 123 4567') === '+265991234567' && emailAuth.normalizeMalawiPhone('0991234567') === '+265991234567' && emailAuth.normalizeMalawiPhone('+265991234567') === '+265991234567');
  report('Email is masked in messages', emailService.maskEmail('pranay@example.com') === 'p***@e***.com');

  console.log('\n--- 2. Requesting a code ---');
  const badReq = await errOf(emailAuth.requestEmailOtp('not-an-email', '1.1.1.1'));
  report('An invalid email is refused', !!badReq && /valid email/i.test(badReq.message));
  const r1 = await emailAuth.requestEmailOtp('New.User@Example.com', '1.1.1.1');
  const code1 = lastCode();
  report('A 6-digit code is sent to the normalised address', /^\d{6}$/.test(code1) && sent[0].to === 'new.user@example.com');
  report('The code is NEVER returned in the API response', !JSON.stringify(r1).includes(code1));
  const stored = db.otps.get('new.user@example.com');
  report('Only an HMAC hash is stored, never the code',
    !!stored && !JSON.stringify(stored).includes(code1) && stored.codeHash === authService.hashOtp('email:new.user@example.com', code1));
  const cool = await errOf(emailAuth.requestEmailOtp('new.user@example.com', '1.1.1.1'));
  report('A second request within 60 seconds is blocked', !!cool && /wait/i.test(cool.message) && cool.statusCode === 429);

  console.log('\n--- 3. Limits that protect the free email quota ---');
  advance(61000);
  process.env.OTP_DAILY_CAP_PER_PHONE = '2';
  await emailAuth.requestEmailOtp('new.user@example.com', '1.1.1.1');
  advance(61000);
  const capErr = await errOf(emailAuth.requestEmailOtp('new.user@example.com', '1.1.1.1'));
  report('A daily cap per email address is enforced', !!capErr && /quota/i.test(capErr.message));
  delete process.env.OTP_DAILY_CAP_PER_PHONE;
  emailAuth.resetEmailRateLimitsForTesting();
  process.env.EMAIL_DAILY_CAP_TOTAL = '1';
  await emailAuth.requestEmailOtp('a1@example.com', '2.2.2.2');
  const totalErr = await errOf(emailAuth.requestEmailOtp('a2@example.com', '3.3.3.3'));
  report('A total daily cap protects the free provider quota', !!totalErr && /daily login-code limit/i.test(totalErr.message));
  delete process.env.EMAIL_DAILY_CAP_TOTAL;
  emailAuth.resetEmailRateLimitsForTesting();
  failSend = true;
  const failErr = await errOf(emailAuth.requestEmailOtp('fail@example.com', '4.4.4.4'));
  failSend = false;
  report('If the email cannot be delivered, no code is stored as sent', !!failErr && /delivery failed/i.test(failErr.message) && !db.otps.has('fail@example.com'));

  console.log('\n--- 4. Wrong codes and lockout ---');
  emailAuth.resetEmailRateLimitsForTesting();
  await emailAuth.requestEmailOtp('lock@example.com', '5.5.5.5');
  const good = lastCode();
  const wrong = good === '123456' ? '654321' : '123456';
  const w1 = await errOf(emailAuth.loginWithEmail({ email: 'lock@example.com', otp: wrong, name: 'L', phone: '0991110000' }));
  report('A wrong code is rejected and attempts are counted', !!w1 && /4 attempt/.test(w1.message) && db.otps.get('lock@example.com').attempts === 1);
  for (let i = 0; i < 4; i++) await errOf(emailAuth.loginWithEmail({ email: 'lock@example.com', otp: wrong }));
  const locked = await errOf(emailAuth.loginWithEmail({ email: 'lock@example.com', otp: good, name: 'Locky', phone: '0991110000' }));
  report('After 5 wrong attempts even the right code is refused', !!locked && /locked/i.test(locked.message));

  console.log('\n--- 5. New account: two steps, rider role only ---');
  emailAuth.resetEmailRateLimitsForTesting();
  await emailAuth.requestEmailOtp('Brand.New@Example.com', '6.6.6.6');
  const c = lastCode();
  const need = await errOf(emailAuth.loginWithEmail({ email: 'brand.new@example.com', otp: c }));
  report('A new person is asked for name and mobile number (409 PROFILE_REQUIRED)', !!need && need.code === 'PROFILE_REQUIRED' && need.statusCode === 409);
  report('That step does NOT consume the code', db.otps.get('brand.new@example.com').isConsumed === false);
  const badPhone = await errOf(emailAuth.loginWithEmail({ email: 'brand.new@example.com', otp: c, name: 'Bea', phone: '+14155552671' }));
  report('A non-Malawian number is not accepted', !!badPhone && badPhone.code === 'PROFILE_REQUIRED');
  const taken = await errOf(emailAuth.loginWithEmail({ email: 'brand.new@example.com', otp: c, name: 'Bea', phone: '+265993333333' }));
  report('A number already registered to someone else is refused, and the code stays valid',
    !!taken && taken.code === 'PHONE_IN_USE' && db.otps.get('brand.new@example.com').isConsumed === false);
  const ok = await emailAuth.loginWithEmail({ email: 'brand.new@example.com', otp: c, name: ' Bea ', phone: '99 888 7766', role: 'ADMIN' });
  report('The account is created as RIDER with a normalised email, name and phone',
    ok.success && ok.user.role === 'RIDER' && ok.user.email === 'brand.new@example.com' && ok.user.name === 'Bea' && ok.user.phone === '+265998887766');
  report('A client-supplied role is ignored', db.users.find((u) => u.email === 'brand.new@example.com').role === 'RIDER');
  report('A wallet is created and the signup is audited with the phone marked unverified',
    db.wallets.some((w) => w.userId === ok.user.id && w.balanceMWK === 0) && db.audit.some((a) => a.action === 'USER_REGISTER' && a.details.phoneVerified === false));
  report('Access and refresh tokens are issued (refresh token stored hashed)',
    typeof ok.accessToken === 'string' && ok.accessToken.split('.').length === 3 && ok.refreshToken.length > 40 &&
    db.refresh.length > 0 && !JSON.stringify(db.refresh).includes(ok.refreshToken));
  const reuse = await errOf(emailAuth.loginWithEmail({ email: 'brand.new@example.com', otp: c }));
  report('A code can only be used once', !!reuse && /already been used/i.test(reuse.message));

  console.log('\n--- 6. Existing accounts ---');
  process.env.OTP_DAILY_CAP_PER_PHONE = '50';
  emailAuth.resetEmailRateLimitsForTesting();
  let ipn = 0;
  const nextIp = () => `10.0.0.${++ipn}`;
  const freshCode = async (email) => { advance(61000); await emailAuth.requestEmailOtp(email, nextIp()); return lastCode(); };
  const back = await emailAuth.loginWithEmail({ email: 'RITA@example.com', otp: await freshCode('rita@example.com') });
  report('A returning rider logs in without re-entering details', back.success && back.user.id === 'U-EXIST');
  const susp = await errOf(emailAuth.loginWithEmail({ email: 'sam@example.com', otp: await freshCode('sam@example.com') }));
  report('A suspended account is refused', !!susp && susp.statusCode === 403);
  const adminViaRider = await errOf(emailAuth.loginWithEmail({ email: 'boss@aarohan.test', otp: await freshCode('boss@aarohan.test') }));
  report('An admin cannot log in through the rider route', !!adminViaRider && adminViaRider.statusCode === 403 && /admin/i.test(adminViaRider.message));

  console.log('\n--- 7. Admin login: code AND password, with lockout ---');
  const adm = await emailAuth.adminEmailLogin({ email: 'boss@aarohan.test', password: 'S3cure-Admin-Pass', otp: await freshCode('boss@aarohan.test') });
  report('The admin signs in with the emailed code plus the password', adm.success && adm.user.role === 'ADMIN' && !!adm.accessToken);
  const badPw = await errOf(emailAuth.adminEmailLogin({ email: 'boss@aarohan.test', password: 'nope-nope', otp: await freshCode('boss@aarohan.test') }));
  report('A wrong admin password is refused with attempts remaining', !!badPw && badPw.statusCode === 401 && /4 attempt/.test(badPw.message));
  let lastErr = null;
  for (let i = 0; i < 4; i++) {
    lastErr = await errOf(emailAuth.adminEmailLogin({ email: 'boss@aarohan.test', password: 'wrong-again', otp: await freshCode('boss@aarohan.test') }));
  }
  report('Five wrong passwords lock the admin account for 15 minutes', !!lastErr && lastErr.statusCode === 429 && /locked/i.test(lastErr.message));
  const whileLocked = await errOf(emailAuth.adminEmailLogin({ email: 'boss@aarohan.test', password: 'S3cure-Admin-Pass', otp: await freshCode('boss@aarohan.test') }));
  report('While locked, even the right password is refused', !!whileLocked && whileLocked.statusCode === 429);
  const notAdmin = await errOf(emailAuth.adminEmailLogin({ email: 'rita@example.com', password: 'S3cure-Admin-Pass', otp: await freshCode('rita@example.com') }));
  report('A non-admin cannot use the admin login', !!notAdmin && notAdmin.statusCode === 403);
  delete process.env.OTP_DAILY_CAP_PER_PHONE;

  console.log('\n--- 8. Only one sign-in method is open at a time ---');
  report('AUTH_MODE selects the method (default phone)', featureFlags.authMode({ AUTH_MODE: 'email' }) === 'email' && featureFlags.authMode({}) === 'phone' && featureFlags.authMode({ AUTH_MODE: 'whatever' }) === 'phone');
  const routes = read('routes/auth.js');
  report('Phone routes answer 404 in email mode and email routes answer 404 in phone mode',
    ["'/otp/request', requireMode('phone')", "'/otp/verify', requireMode('phone')", "requireMode('phone'), validateBody(adminLoginSchema)",
      "'/email/otp/request', requireMode('email')", "'/email/otp/verify', requireMode('email')", "requireMode('email'), validateBody(adminEmailLoginSchema)"].every((s) => routes.includes(s)));
  report('The public app config tells the screens which method to show', read('server.js').includes('authMode: featureFlags.authMode()'));

  console.log('\n--- 9. Email sender and production checks ---');
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  process.env.NODE_ENV = 'production';
  process.env.EMAIL_FROM_ADDRESS = 'no-reply@aarohan.test';
  process.env.EMAIL_PROVIDER = 'brevo'; process.env.BREVO_API_KEY = 'brevo-key-for-tests-123456';
  await emailService.sendEmail({ to: 'x@example.com', subject: 'S', text: 'T', html: '<p>T</p>' });
  const b = JSON.parse(calls[0].opts.body);
  report('Brevo is called with its API key header and the right fields',
    calls[0].url === 'https://api.brevo.com/v3/smtp/email' && calls[0].opts.headers['api-key'] === 'brevo-key-for-tests-123456' && b.to[0].email === 'x@example.com' && b.sender.email === 'no-reply@aarohan.test');
  process.env.EMAIL_PROVIDER = 'resend'; process.env.RESEND_API_KEY = 'resend-key-for-tests-123456';
  await emailService.sendEmail({ to: 'x@example.com', subject: 'S', text: 'T', html: '<p>T</p>' });
  report('Resend is called with a Bearer token', calls[1].url === 'https://api.resend.com/emails' && calls[1].opts.headers.Authorization === 'Bearer resend-key-for-tests-123456');
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'leaked@example.com' });
  const pErr = await errOf(emailService.sendEmail({ to: 'x@example.com', subject: 'S', text: 'T', html: 'h' }));
  report('Provider errors never echo addresses back', !!pErr && /status 401/.test(pErr.message) && !pErr.message.includes('leaked@example.com'));
  process.env.EMAIL_PROVIDER = 'simulator';
  const simErr = await errOf(emailService.sendEmail({ to: 'x@example.com', subject: 'S', text: 'T', html: 'h' }));
  report('The simulator refuses to "send" in production', !!simErr && /production/i.test(simErr.message));
  global.fetch = realFetch;
  process.env.NODE_ENV = 'development';
  const logs = []; const realLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  await realSendOtpEmail({ to: 'dev@example.com', code: '424242' });
  console.log = realLog;
  report('In development the simulator prints the code so the app can be tested', logs.some((l) => l.includes('[DEV EMAIL OTP] dev@example.com : 424242')));

  const prod = {
    NODE_ENV: 'production', JWT_SECRET: 'aarohan-super-strong-production-jwt-secret-key-64-bytes-long-ok',
    OTP_HMAC_SECRET: 'aarohan-otp-hmac-production-key-32-bytes-ok', DATABASE_URL: 'postgresql://postgres:securepass@db.supabase.co:5432/aarohan',
    SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super-long-valid-supabase-service-key', AAROHAN_SECURITY_DESK_PHONE: '+265881234567'
  };
  const throws = (env, needle) => { try { validateStartupConfig(env, true); return false; } catch (e) { return e.message.includes(needle); } };
  report('Phone mode needs no email settings', validateStartupConfig({ ...prod }, true).valid === true);
  report('Email mode in production refuses to start without a real provider', throws({ ...prod, AUTH_MODE: 'email' }, 'EMAIL_PROVIDER'));
  report('Email mode refuses a missing API key or sender address',
    throws({ ...prod, AUTH_MODE: 'email', EMAIL_PROVIDER: 'brevo', EMAIL_FROM_ADDRESS: 'a@b.com' }, 'BREVO_API_KEY') && throws({ ...prod, AUTH_MODE: 'email', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k'.repeat(20) }, 'EMAIL_FROM_ADDRESS'));
  report('Email mode starts with a complete provider setup',
    validateStartupConfig({ ...prod, AUTH_MODE: 'email', EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'k'.repeat(24), EMAIL_FROM_ADDRESS: 'no-reply@aarohan.test' }, true).valid === true);

  console.log('\n--- 10. Migration and admin script ---');
  const mig = read('prisma/migrations/20261108_email_otp/migration.sql');
  report('The migration is additive, locked down (RLS) and keeps one account per email',
    /CREATE TABLE IF NOT EXISTS "EmailOtp"/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig) && /User_email_lower_key/.test(mig) && !/DROP |ALTER COLUMN|RENAME/i.test(mig));
  report('The Prisma model matches the migration', /model EmailOtp \{[\s\S]*email\s+String\s+@unique/.test(read('prisma/schema.prisma')));
  const script = read('scripts/create-admin.js');
  report('The admin script supports an email and writes a valid audit record',
    script.includes('ADMIN_EMAIL') && script.includes("action: 'USER_REGISTER'") && !/actorId|targetType|ADMIN_PROVISIONED/.test(script));

  console.log('\n--- 11. The screens ---');
  const authJs = read('shared/auth.js');
  report('The login box switches to email when the server says AUTH_MODE=email',
    authJs.includes('loadAuthMode()') && authJs.includes("cfg.authMode === 'email'") && authJs.includes('id="auth-email-input"'));
  report('The email screens call the email routes (rider, driver portal and admin)',
    ['/api/auth/email/otp/request', '/api/auth/email/otp/verify', '/api/auth/admin/email-login'].every((u) => authJs.includes(u)));
  report('First-time people are asked for name and mobile number, then resubmit the same code',
    authJs.includes("data.code === 'PROFILE_REQUIRED'") && authJs.includes('id="auth-profile-fields"') && authJs.includes('auth-profile-name'));
  report('The original phone screens keep their element ids (the phone browser test relies on them)',
    authJs.includes('id="auth-phone-input"') && authJs.includes('id="auth-phone-submit"') && authJs.includes('id="auth-otp-input"'));
  const i18nJs = read('shared/i18n.js');
  report('Email wording exists in English and Chichewa (Chichewa flagged for review)',
    (i18nJs.match(/emailLabel:/g) || []).length === 2 && (i18nJs.match(/profileRequiredMsg:/g) || []).length === 2 && i18nJs.includes('NEEDS NATIVE REVIEW (email-login wording'));
  report('A browser test covers the email screens and consent',
    read('tests/test_playwright_email_login.js').includes('#auth-consent') && JSON.parse(read('package.json')).scripts['test:playwright:email'] === 'node tests/test_playwright_email_login.js');
  report('The email suite runs as part of npm test and npm run test:offline',
    JSON.parse(read('package.json')).scripts.test.includes('test_email_login_offline.js') && JSON.parse(read('package.json')).scripts['test:offline'].includes('test_email_login_offline.js'));

  Date.now = realNow;
  console.log('\n=============================================================');
  console.log(`   EMAIL LOGIN RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('=============================================================');
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { Date.now = realNow; console.error('Suite crashed:', e); process.exit(1); });
