'use strict';
// Sign in with Google: token checks, existing users, new users, blocked accounts. No network, no database.
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.OTP_HMAC_SECRET = 'test-otp-hmac-secret-16plus';
process.env.GOOGLE_CLIENT_ID = 'test-client-id-1234567890.apps.googleusercontent.com';

let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };

const users = [], wallets = [], audits = [], tokens = [];
const prisma = {
  user: {
    findFirst: async ({ where }) => users.find((u) => u.email === where.email) || null,
    findUnique: async ({ where }) => users.find((u) => u.phone === where.phone || u.id === where.id) || null,
    create: async ({ data }) => { const u = { id: 'U' + (users.length + 1), driverProfile: null, wallet: null, ...data }; users.push(u); return u; }
  },
  wallet: { create: async ({ data }) => { wallets.push(data); return data; } },
  auditLog: { create: async ({ data }) => { audits.push(data); return data; } },
  refreshToken: { create: async ({ data }) => { tokens.push(data); return { id: 'T' + tokens.length, ...data }; } },
  $transaction: async (x) => (typeof x === 'function' ? x(prisma) : Promise.all(x))
};
const pp = require.resolve('../lib/prisma');
require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: prisma };

const g = require('../services/googleAuth');
const CRED = 'x'.repeat(80);
const good = (o = {}) => ({ iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: String(Math.floor(Date.now() / 1000) + 600), email: 'Rita@Example.com', email_verified: 'true', name: 'Rita Banda', ...o });
const run = async (claims, extra = {}) => { g.setVerifierForTesting(async () => claims); try { return { ok: await g.loginWithGoogle({ credential: CRED, ...extra }) }; } catch (e) { return { err: e }; } };

(async () => {
  console.log('--- Sign in with Google ---');
  report('Google sign-in is on only when a client id is set', g.enabled() === true);
  let r = await run(good({ aud: 'someone-elses-app.apps.googleusercontent.com' }));
  report('A token made for another app is refused', r.err && r.err.statusCode === 401);
  r = await run(good({ iss: 'https://evil.example.com' }));
  report('A token from a wrong issuer is refused', r.err && r.err.statusCode === 401);
  r = await run(good({ exp: String(Math.floor(Date.now() / 1000) - 10) }));
  report('An expired token is refused', r.err && r.err.statusCode === 401);
  r = await run(good({ email_verified: 'false' }));
  report('An unverified Google email is refused', r.err && r.err.statusCode === 401);
  g.setVerifierForTesting(async () => { throw new Error('offline'); });
  try { await g.loginWithGoogle({ credential: CRED }); report('If Google cannot be reached the login fails safely', false); } catch (e) { report('If Google cannot be reached the login fails safely', e.statusCode === 503); }
  try { await g.loginWithGoogle({ credential: 'short' }); report('A junk credential is refused', false); } catch (e) { report('A junk credential is refused', e.statusCode === 400); }

  r = await run(good());
  report('A new person must add a Malawian mobile number first (name is suggested from Google)', r.err && r.err.code === 'PROFILE_REQUIRED' && r.err.suggestedName === 'Rita Banda' && users.length === 0);
  r = await run(good(), { phone: '12345' });
  report('A bad phone number does not create an account', r.err && r.err.code === 'PROFILE_REQUIRED' && users.length === 0);
  r = await run(good(), { phone: '0998877665' });
  report('With a valid number the account is created, with a wallet and an audit entry', r.ok && r.ok.success && users.length === 1 && users[0].email === 'rita@example.com' && users[0].role === 'RIDER' && users[0].phone === '+265998877665' && wallets.length === 1 && audits.some((a) => a.details.provider === 'google'));
  report('The person gets an access token and a stored refresh token', r.ok && r.ok.accessToken && r.ok.refreshToken && tokens.length === 1);
  report('The audit log never stores the full email', !JSON.stringify(audits).includes('rita@example.com'));
  r = await run(good());
  report('Signing in again finds the same account (no duplicate)', r.ok && users.length === 1 && r.ok.user.id === users[0].id);
  r = await run(good({ email: 'other@example.com' }), { phone: '0998877665' });
  report('A number already used by someone else is refused', r.err && r.err.code === 'PHONE_IN_USE');
  users[0].status = 'SUSPENDED';
  r = await run(good());
  report('A suspended account cannot sign in', r.err && r.err.statusCode === 403);
  users[0].status = 'ACTIVE'; users[0].role = 'ADMIN';
  r = await run(good());
  report('Admin accounts cannot use Google sign-in', r.err && r.err.statusCode === 403);
  process.env.GOOGLE_CLIENT_ID = '';
  r = await run(good());
  report('With no client id configured it is switched off', r.err && r.err.statusCode === 503);

  const fs = require('fs'), path = require('path');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  report('The page security policy allows Google\'s sign-in button', server.includes("'https://accounts.google.com'") && server.includes('frameSrc'));
  report('The public app config shares only the client id (not a secret)', server.includes('googleClientId') && !/GOOGLE_CLIENT_SECRET/.test(server));
  console.log(`\n   GOOGLE SIGN-IN RESULTS: ${passed}/${total} TESTS PASSED`);
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('crashed', e); process.exit(1); });
