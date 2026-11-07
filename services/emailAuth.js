// ============================================================================
// Aarohan email login (AUTH_MODE=email): same security rules as phone login.
//   - 6-digit CSPRNG code, HMAC-hashed with a server secret, 5-minute expiry
//   - 60s cooldown + daily caps per email, per IP, and in total (protects the free email quota)
//   - 5 wrong attempts lock the code; the code is single-use (atomic)
//   - accounts are created strictly as RIDER; the role is never taken from the client
//   - the email is the verified identity; the phone number is collected but NOT verified
// ============================================================================

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const authService = require('./auth');
const emailService = require('./email');

class AuthError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = 24 * 60 * 60 * 1000;

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

// Accepts "99 123 4567", "0991234567" or "+265991234567"
function normalizeMalawiPhone(raw) {
  let p = String(raw || '').replace(/[\s-]/g, '');
  if (!p) return '';
  if (p.startsWith('0')) p = '+265' + p.slice(1);
  else if (!p.startsWith('+265')) p = '+265' + p;
  return p;
}

const hashEmailOtp = (email, otp) => authService.hashOtp('email:' + email, otp);

// ---------------------------------------------------------------------------
// In-memory rate limits
// ---------------------------------------------------------------------------
const emailLimits = new Map();
const ipLimits = new Map();
const total = { count: 0, resetAt: Date.now() + DAY };
const adminLocks = new Map();

const totalCap = () => {
  const n = parseInt(process.env.EMAIL_DAILY_CAP_TOTAL, 10);
  return Number.isFinite(n) && n > 0 ? n : 250; // stays under Brevo's free 300/day
};

function resetEmailRateLimitsForTesting() {
  emailLimits.clear();
  ipLimits.clear();
  adminLocks.clear();
  total.count = 0;
  total.resetAt = Date.now() + DAY;
}

function checkLimits(email, ip) {
  const now = Date.now();

  if (now > total.resetAt) { total.count = 0; total.resetAt = now + DAY; }
  if (total.count >= totalCap()) {
    throw new AuthError('The daily login-code limit has been reached. Please try again tomorrow or contact Aarohan.', 429);
  }

  if (ip) {
    const rec = ipLimits.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000, daily: 0, dailyResetAt: now + DAY };
    if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 15 * 60 * 1000; }
    if (now > rec.dailyResetAt) { rec.daily = 0; rec.dailyResetAt = now + DAY; }
    if (rec.daily >= authService.getOtpDailyCapPerIp()) {
      throw new AuthError('Daily login-code quota exceeded for this network. Please try again tomorrow.', 429);
    }
    if (rec.count >= 10) {
      throw new AuthError(`Too many code requests from this network. Please wait ${Math.ceil((rec.resetAt - now) / 60000)} minute(s).`, 429);
    }
    rec.count++; rec.daily++;
    ipLimits.set(ip, rec);
  }

  const rec = emailLimits.get(email) || { last: 0, daily: 0, dailyResetAt: now + DAY };
  if (now > rec.dailyResetAt) { rec.daily = 0; rec.dailyResetAt = now + DAY; }
  const since = (now - rec.last) / 1000;
  if (since < 60) {
    throw new AuthError(`Please wait ${Math.ceil(60 - since)} seconds before requesting a new verification code.`, 429);
  }
  const cap = authService.getOtpDailyCapPerPhone();
  if (rec.daily >= cap) {
    throw new AuthError(`Daily verification quota (${cap}) exceeded for this email address. Please try again tomorrow.`, 429);
  }
  rec.last = now; rec.daily++; total.count++;
  emailLimits.set(email, rec);
}

// ---------------------------------------------------------------------------
// Request a code
// ---------------------------------------------------------------------------
async function requestEmailOtp(email, ip = null) {
  authService.assertAuthSecrets();

  const clean = normalizeEmail(email);
  if (!clean) throw new AuthError('Please enter a valid email address.');

  checkLimits(clean, ip);

  const code = crypto.randomInt(100000, 1000000).toString();
  const codeHash = hashEmailOtp(clean, code);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Send FIRST: if delivery fails the code must not be stored as "sent".
  try {
    await emailService.sendOtpEmail({ to: clean, code });
  } catch (err) {
    prisma.auditLog.create({
      data: { action: 'OTP_FAILED', entityType: 'EMAIL_OTP', details: { emailMasked: emailService.maskEmail(clean), error: err.message }, ipAddress: ip }
    }).catch(() => {});
    throw new AuthError('Email delivery failed. Please try again later.', 502);
  }

  await prisma.emailOtp.upsert({
    where: { email: clean },
    create: { email: clean, codeHash, attempts: 0, maxAttempts: 5, expiresAt, isConsumed: false, ipAddress: ip },
    update: { codeHash, attempts: 0, expiresAt, isConsumed: false, ipAddress: ip }
  });

  return {
    success: true,
    message: `Verification code sent to ${emailService.maskEmail(clean)}. Valid for 5 minutes.`,
    expiresInSeconds: 300
  };
}

// ---------------------------------------------------------------------------
// Check a code (does NOT consume it) / consume it atomically
// ---------------------------------------------------------------------------
async function checkEmailOtp(email, otp, ip = null) {
  authService.assertAuthSecrets();

  const code = typeof otp === 'string' ? otp.trim() : '';
  if (!/^\d{6}$/.test(code)) throw new AuthError('Verification code must be exactly 6 digits.');

  const rec = await prisma.emailOtp.findUnique({ where: { email } });
  if (!rec) throw new AuthError('No verification code requested for this email address. Please request a new code.');
  if (rec.attempts >= rec.maxAttempts) {
    throw new AuthError('Verification code locked: Maximum failed attempts (5) exceeded. Please request a new code.', 429);
  }
  if (new Date() > rec.expiresAt) throw new AuthError('Verification code has expired. Please request a new code.');
  if (rec.isConsumed) throw new AuthError('Verification code has already been used. Please request a new code.');

  const expected = Buffer.from(rec.codeHash, 'hex');
  const provided = Buffer.from(hashEmailOtp(email, code), 'hex');
  const ok = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

  if (!ok) {
    const attempts = rec.attempts + 1;
    await prisma.emailOtp.update({ where: { email }, data: { attempts } });
    await prisma.auditLog.create({
      data: {
        action: attempts >= rec.maxAttempts ? 'OTP_LOCKED' : 'OTP_FAILED',
        entityType: 'EMAIL_OTP',
        details: { emailMasked: emailService.maskEmail(email), attempts },
        ipAddress: ip
      }
    }).catch(() => {});
    if (attempts >= rec.maxAttempts) {
      throw new AuthError('Verification code locked: Maximum failed attempts (5) exceeded. Please request a new code.', 429);
    }
    throw new AuthError(`Invalid verification code. ${rec.maxAttempts - attempts} attempt(s) remaining.`, 401);
  }
  return rec;
}

async function consumeEmailOtp(email) {
  // Atomic: only one request can ever consume a code.
  const result = await prisma.emailOtp.updateMany({ where: { email, isConsumed: false }, data: { isConsumed: true } });
  if (result.count !== 1) {
    throw new AuthError('Verification code has already been used. Please request a new code.');
  }
}

async function issueSession(user, ip, userAgent) {
  const accessToken = authService.issueAccessToken(user);
  const { rawRefreshToken } = await authService.issueRefreshToken(user.id, userAgent, ip);
  return { accessToken, refreshToken: rawRefreshToken };
}

const publicUser = (u, withProfile = true) => ({
  id: u.id,
  email: u.email || null,
  phone: u.phone,
  name: u.name,
  role: u.role,
  status: u.status,
  ...(withProfile
    ? { driverProfile: u.driverProfile ? { id: u.driverProfile.id, approvalStatus: u.driverProfile.approvalStatus, availability: u.driverProfile.availability } : null }
    : {})
});

// ---------------------------------------------------------------------------
// Rider / driver-portal login (creates RIDER accounts only)
// ---------------------------------------------------------------------------
async function loginWithEmail({ email, otp, name, phone, ip = null, userAgent = null }) {
  const clean = normalizeEmail(email);
  if (!clean) throw new AuthError('Please enter a valid email address.');

  await checkEmailOtp(clean, otp, ip);

  let user = await prisma.user.findFirst({ where: { email: clean }, include: { driverProfile: true, wallet: true } });

  if (user) {
    if (user.status !== 'ACTIVE') throw new AuthError(`Account is ${String(user.status).toLowerCase()}. Access denied.`, 403);
    if (user.role === 'ADMIN') {
      throw new AuthError('Administrative accounts require dual-factor password authentication via /api/auth/admin/email-login.', 403);
    }
    await consumeEmailOtp(clean);
  } else {
    // New account: needs a name and a Malawian number. The code is NOT consumed until the
    // account is complete, so the person can fill in the details and resubmit the same code.
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanPhone = normalizeMalawiPhone(phone);
    if (cleanName.length < 2 || cleanName.length > 60 || !authService.validateMalawianPhone(cleanPhone)) {
      throw new AuthError('Welcome! Please add your name and Malawian mobile number to finish creating your account.', 409, 'PROFILE_REQUIRED');
    }
    const phoneOwner = await prisma.user.findUnique({ where: { phone: cleanPhone } });
    if (phoneOwner) throw new AuthError('This mobile number is already registered to another account.', 409, 'PHONE_IN_USE');

    await consumeEmailOtp(clean);
    try {
      user = await prisma.user.create({
        data: { email: clean, phone: cleanPhone, name: cleanName, role: 'RIDER', status: 'ACTIVE' },
        include: { driverProfile: true, wallet: true }
      });
    } catch (err) {
      if (err && err.code === 'P2002') throw new AuthError('This email or mobile number is already registered. Please request a new code.', 409, 'ACCOUNT_EXISTS');
      throw err;
    }
    await prisma.wallet.create({ data: { userId: user.id, balanceMWK: 0 } });
    await prisma.auditLog.create({
      data: {
        user: { connect: { id: user.id } },
        action: 'USER_REGISTER',
        entityType: 'USER',
        entityId: user.id,
        details: { emailMasked: emailService.maskEmail(clean), role: 'RIDER', phoneVerified: false },
        ipAddress: ip
      }
    });
  }

  const session = await issueSession(user, ip, userAgent);
  return { success: true, ...session, user: publicUser(user) };
}

// ---------------------------------------------------------------------------
// Admin login: email code + password, with the same lockout as phone login
// ---------------------------------------------------------------------------
async function adminEmailLogin({ email, password, otp, ip = null, userAgent = null }) {
  const clean = normalizeEmail(email);
  if (!clean) throw new AuthError('Please enter a valid email address.');

  const lock = adminLocks.get(clean);
  if (lock && lock.lockedUntil && Date.now() < lock.lockedUntil) {
    throw new AuthError(`Admin login locked due to repeated failed password attempts. Try again in ${Math.ceil((lock.lockedUntil - Date.now()) / 60000)} minute(s).`, 429);
  }

  await checkEmailOtp(clean, otp, ip);
  await consumeEmailOtp(clean);

  const user = await prisma.user.findFirst({ where: { email: clean }, include: { wallet: true } });
  if (!user || user.role !== 'ADMIN') throw new AuthError('Access denied: User is not an authorized administrator.', 403);
  if (user.status !== 'ACTIVE') throw new AuthError(`Admin account is ${String(user.status).toLowerCase()}. Access denied.`, 403);
  if (!user.passwordHash) throw new AuthError('Admin account has no password configured. Run scripts/create-admin.js.', 500);

  const valid = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!valid) {
    const attempts = (lock ? lock.attempts : 0) + 1;
    if (attempts >= 5) {
      adminLocks.set(clean, { attempts, lockedUntil: Date.now() + 15 * 60 * 1000 });
      await prisma.auditLog.create({
        data: {
          user: { connect: { id: user.id } },
          action: 'OTP_LOCKED',
          entityType: 'USER',
          entityId: user.id,
          details: { type: 'ADMIN_PASSWORD_LOCKOUT', reason: 'Exceeded 5 failed admin password attempts' },
          ipAddress: ip
        }
      }).catch(() => {});
      throw new AuthError('Admin account locked for 15 minutes: Maximum failed password attempts (5) exceeded.', 429);
    }
    adminLocks.set(clean, { attempts, lockedUntil: null });
    throw new AuthError(`Invalid administrative password credentials. ${5 - attempts} attempt(s) remaining before lockout.`, 401);
  }
  adminLocks.delete(clean);

  const session = await issueSession(user, ip, userAgent);
  await prisma.auditLog.create({
    data: { user: { connect: { id: user.id } }, action: 'USER_LOGIN', entityType: 'USER', entityId: user.id, details: { role: 'ADMIN', channel: 'EMAIL' }, ipAddress: ip }
  }).catch(() => {});

  return { success: true, ...session, user: publicUser(user, false) };
}

module.exports = {
  AuthError,
  normalizeEmail,
  normalizeMalawiPhone,
  requestEmailOtp,
  checkEmailOtp,
  loginWithEmail,
  adminEmailLogin,
  resetEmailRateLimitsForTesting
};
