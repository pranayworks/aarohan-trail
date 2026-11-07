// ============================================================================
// AAROHAN AUTHENTICATION & IDENTITY SERVICE • LILONGWE, MALAWI
// ============================================================================
// Implements:
//   1. E.164 Malawian Phone Validation (+265...)
//   2. Cryptographic 6-digit OTP generation via crypto.randomInt
//   3. HMAC-SHA256 OTP hashing with server secret (OTP_HMAC_SECRET)
//   4. Per-phone & Per-IP rate limiting + daily SMS quotas
//   5. 5-attempt wrong OTP lockout with AuditLog emission
//   6. HS256 JWT access tokens (15m expiry) & rotating refresh tokens (30d)
//   7. SHA-256 hashed refresh tokens with replay detection & breach invalidation
//   8. Strict Role & Status verification (UserStatus.ACTIVE, DriverApproval.APPROVED)
// ============================================================================

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const notificationService = require('./notifications');
const { maskPhoneNumber } = require('./notifications');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('FATAL: Server startup refused. JWT_SECRET must be set in .env with at least 32 characters.');
  }
  return secret;
}

function getOtpHmacSecret() {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('FATAL: Server startup refused. OTP_HMAC_SECRET must be set in .env with at least 16 characters.');
  }
  return secret;
}

// Server refuses to start without valid JWT_SECRET (32+ chars)
function assertAuthSecrets() {
  getJwtSecret();
  getOtpHmacSecret();
}

// In-memory rate limiting tracking
// Key: phone or IP -> { lastRequestAt, countLast15Mins, dailyCount, resetDailyAt }
const phoneRateLimits = new Map();
const ipRateLimits = new Map();
let globalSmsTracking = {
  dailyCount: 0,
  dailyResetAt: Date.now() + 24 * 60 * 60 * 1000
};

function getOtpDailyCapPerPhone() {
  const cap = parseInt(process.env.OTP_DAILY_CAP_PER_PHONE, 10);
  return Number.isFinite(cap) && cap > 0 ? cap : 5;
}

function getOtpDailyCapPerIp() {
  const cap = parseInt(process.env.OTP_DAILY_CAP_PER_IP, 10);
  return Number.isFinite(cap) && cap > 0 ? cap : 40;
}

function getSmsDailyCapTotal() {
  const cap = parseInt(process.env.SMS_DAILY_CAP_TOTAL, 10);
  return Number.isFinite(cap) && cap > 0 ? cap : 50;
}

function resetRateLimitsForTesting() {
  phoneRateLimits.clear();
  ipRateLimits.clear();
  globalSmsTracking.dailyCount = 0;
  globalSmsTracking.dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;
}

function resetCooldownForTesting(phone) {
  const rec = phoneRateLimits.get(phone);
  if (rec) rec.lastRequestedAt = 0;
}

/**
 * Validates Malawian E.164 phone numbers:
 * Starts with +265 followed by valid mobile prefixes (88, 98, 99, 89, etc.) and 7 digits.
 * Standard format: +265XXXXXXXXX (12 characters total).
 */
function validateMalawianPhone(phone) {
  if (typeof phone !== 'string') return false;
  const cleaned = phone.trim();
  // Valid Malawi mobile numbers according to MACRA:
  // TNM: 88, 89, 31
  // Airtel: 99, 98, 90
  // Standard format: +265 followed by 9 digits
  const malawiRegex = /^\+265(88|89|98|99|90|31)\d{7}$/;
  return malawiRegex.test(cleaned);
}

/**
 * Compute HMAC-SHA256 hash for phone + OTP
 */
function hashOtp(phone, otp) {
  const secret = getOtpHmacSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(`${phone.trim()}:${otp.trim()}`)
    .digest('hex');
}

/**
 * Compute SHA-256 hash for raw refresh token
 */
function hashRefreshToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
}

/**
 * Check and record rate limits for OTP requests.
 * - Global Platform SMS Cap: configurable via SMS_DAILY_CAP_TOTAL
 * - Per Phone: max 1 per 60 seconds, max OTP_DAILY_CAP_PER_PHONE per 24 hours
 * - Per IP: max 10 per 15 minutes
 */
async function checkOtpRateLimits(phone, ip) {
  const now = Date.now();

  // 1. Check Global Platform Daily SMS Cap
  if (now > globalSmsTracking.dailyResetAt) {
    globalSmsTracking.dailyCount = 0;
    globalSmsTracking.dailyResetAt = now + 24 * 60 * 60 * 1000;
  }
  const maxTotalSms = getSmsDailyCapTotal();
  if (globalSmsTracking.dailyCount >= maxTotalSms) {
    await prisma.auditLog.create({
      data: {
        action: 'SMS_CAP_EXCEEDED',
        entityType: 'SMS',
        details: {
          phoneMasked: maskPhoneNumber(phone),
          dailyCount: globalSmsTracking.dailyCount,
          totalCap: maxTotalSms
        },
        ipAddress: ip
      }
    }).catch(() => {});
    throw new Error('Platform daily SMS dispatch limit reached. Please contact Aarohan operations.');
  }

  // 2. Check IP rate limit (window limit & daily IP cap)
  if (ip) {
    const ipRecord = ipRateLimits.get(ip) || {
      count: 0,
      resetAt: now + 15 * 60 * 1000,
      dailyCount: 0,
      dailyResetAt: now + 24 * 60 * 60 * 1000
    };
    if (now > ipRecord.resetAt) {
      ipRecord.count = 0;
      ipRecord.resetAt = now + 15 * 60 * 1000;
    }
    if (now > ipRecord.dailyResetAt) {
      ipRecord.dailyCount = 0;
      ipRecord.dailyResetAt = now + 24 * 60 * 60 * 1000;
    }

    const maxIpDaily = getOtpDailyCapPerIp();
    if (ipRecord.dailyCount >= maxIpDaily) {
      throw new Error('Daily SMS verification quota exceeded for this IP address. Please try again tomorrow.');
    }

    if (ipRecord.count >= 10) {
      const waitMins = Math.ceil((ipRecord.resetAt - now) / 60000);
      throw new Error(`Too many OTP requests from this IP address. Please wait ${waitMins} minute(s).`);
    }
    ipRecord.count++;
    ipRecord.dailyCount++;
    ipRateLimits.set(ip, ipRecord);
  }

  // 3. Check Phone rate limit
  const phoneRecord = phoneRateLimits.get(phone) || {
    lastRequestedAt: 0,
    dailyCount: 0,
    dailyResetAt: now + 24 * 60 * 60 * 1000
  };

  if (now > phoneRecord.dailyResetAt) {
    phoneRecord.dailyCount = 0;
    phoneRecord.dailyResetAt = now + 24 * 60 * 60 * 1000;
  }

  // Cooldown check (60 seconds)
  const timeSinceLast = (now - phoneRecord.lastRequestedAt) / 1000;
  if (timeSinceLast < 60) {
    const waitSecs = Math.ceil(60 - timeSinceLast);
    throw new Error(`Please wait ${waitSecs} seconds before requesting a new verification code.`);
  }

  // Per-phone Daily SMS Cap
  const maxPerPhone = getOtpDailyCapPerPhone();
  if (phoneRecord.dailyCount >= maxPerPhone) {
    throw new Error(`Daily SMS verification quota (${maxPerPhone}) exceeded for this phone number. Please try again tomorrow.`);
  }

  phoneRecord.lastRequestedAt = now;
  phoneRecord.dailyCount++;
  globalSmsTracking.dailyCount++;
  phoneRateLimits.set(phone, phoneRecord);
}

/**
 * Generate 6-digit OTP and store HMAC-SHA256 hash in database
 */
async function requestOtp(phone, ip = null) {
  assertAuthSecrets();

  const cleanPhone = phone ? phone.trim() : '';
  if (!validateMalawianPhone(cleanPhone)) {
    throw new Error('Invalid Malawian phone number format. Must match +265XXXXXXXXX (e.g., +265991234567)');
  }

  // Enforce rate limits
  await checkOtpRateLimits(cleanPhone, ip);

  // Generate 6-digit cryptographic random OTP (100000 to 999999)
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const codeHash = hashOtp(cleanPhone, otpCode);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

  // Provider Dispatch FIRST: If the provider call fails, do NOT mark OTP as sent
  try {
    await notificationService.sendOtp({
      phone: cleanPhone,
      code: otpCode
    });
  } catch (err) {
    // Audit log failure without logging raw code or full phone
    prisma.auditLog.create({
      data: {
        action: 'OTP_FAILED',
        entityType: 'OTP',
        details: {
          phoneMasked: maskPhoneNumber(cleanPhone),
          error: err.message
        },
        ipAddress: ip
      }
    }).catch(() => {});

    throw new Error('SMS delivery failed. Please try again later.');
  }

  // Provider succeeded -> record in database
  await prisma.otpCode.upsert({
    where: { phone: cleanPhone },
    create: {
      phone: cleanPhone,
      codeHash,
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
      isConsumed: false,
      ipAddress: ip
    },
    update: {
      codeHash,
      attempts: 0,
      expiresAt,
      isConsumed: false,
      ipAddress: ip
    }
  });

  // Record AuditLog
  const existingUser = await prisma.user.findUnique({ where: { phone: cleanPhone } });
  if (existingUser) {
    await prisma.auditLog.create({
      data: {
        user: { connect: { id: existingUser.id } },
        action: 'OTP_REQUEST',
        entityType: 'OTP',
        entityId: cleanPhone,
        details: { expiresAt },
        ipAddress: ip
      }
    });
  }

  return {
    success: true,
    message: `Verification code sent via SMS to ${cleanPhone}. Valid for 5 minutes.`,
    expiresInSeconds: 300
  };
}

/**
 * Verify OTP code against HMAC-SHA256 hash with 5-attempt lockout
 */
async function verifyOtp(phone, otp, ip = null) {
  assertAuthSecrets();

  const cleanPhone = phone ? phone.trim() : '';
  const cleanOtp = otp ? otp.trim() : '';

  if (!validateMalawianPhone(cleanPhone)) {
    throw new Error('Invalid Malawian phone number format.');
  }

  if (!cleanOtp || cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
    throw new Error('Verification code must be exactly 6 digits.');
  }

  const otpRecord = await prisma.otpCode.findUnique({ where: { phone: cleanPhone } });
  if (!otpRecord) {
    throw new Error('No verification code requested for this phone number. Please request a new code.');
  }

  // Check if locked (5 wrong attempts)
  if (otpRecord.attempts >= otpRecord.maxAttempts) {
    throw new Error('Verification code locked: Maximum failed attempts (5) exceeded. Please request a new code.');
  }

  // Check expiration
  if (new Date() > otpRecord.expiresAt) {
    throw new Error('Verification code has expired. Please request a new code.');
  }

  if (otpRecord.isConsumed) {
    throw new Error('Verification code has already been used. Please request a new code.');
  }

  // Compare HMAC-SHA256 hash using timing-safe buffer equality
  const expectedHash = otpRecord.codeHash;
  const providedHash = hashOtp(cleanPhone, cleanOtp);

  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  const providedBuffer = Buffer.from(providedHash, 'hex');

  const isMatch =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!isMatch) {
    const newAttempts = otpRecord.attempts + 1;
    await prisma.otpCode.update({
      where: { phone: cleanPhone },
      data: { attempts: newAttempts }
    });

    const existingUser = await prisma.user.findUnique({ where: { phone: cleanPhone } });
    if (existingUser) {
      await prisma.auditLog.create({
        data: {
          user: { connect: { id: existingUser.id } },
          action: newAttempts >= otpRecord.maxAttempts ? 'OTP_LOCKED' : 'OTP_FAILED',
          entityType: 'OTP',
          entityId: cleanPhone,
          details: { attempts: newAttempts },
          ipAddress: ip
        }
      });
    }

    if (newAttempts >= otpRecord.maxAttempts) {
      throw new Error('Verification code locked: Maximum failed attempts (5) exceeded. Please request a new code.');
    }

    const remaining = otpRecord.maxAttempts - newAttempts;
    throw new Error(`Invalid verification code. ${remaining} attempt(s) remaining.`);
  }

  // Mark consumed
  await prisma.otpCode.update({
    where: { phone: cleanPhone },
    data: { isConsumed: true }
  });

  return { verified: true, phone: cleanPhone };
}

/**
 * Issues HS256 Access Token (15m expiry)
 */
function issueAccessToken(user) {
  assertAuthSecrets();

  const payload = {
    userId: user.id,
    phone: user.phone,
    role: user.role,
    driverId: user.driverProfile ? user.driverProfile.id : null,
    name: user.name || null
  };

  const secret = getJwtSecret();
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '15m'
  });
}

/**
 * Issues Rotating Refresh Token (30d expiry) and records SHA-256 hash in DB
 */
async function issueRefreshToken(userId, userAgent = null, ipAddress = null) {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      userAgent,
      ipAddress
    }
  });

  return { rawRefreshToken: rawToken, expiresAt };
}

/**
 * Rotate Refresh Token with Breach / Replay Detection
 */
async function rotateRefreshToken(rawToken, userAgent = null, ipAddress = null) {
  assertAuthSecrets();

  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error('Refresh token is required');
  }

  const tokenHash = hashRefreshToken(rawToken);
  const existingToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { driverProfile: true } } }
  });

  if (!existingToken) {
    throw new Error('Invalid refresh token');
  }

  // REPLAY DETECTION: Token already revoked!
  if (existingToken.revokedAt) {
    console.warn(`[SECURITY ALERT] Refresh token replay detected for user ${existingToken.userId}! Revoking all sessions.`);
    // Invalidate all tokens for this user immediately
    await prisma.refreshToken.updateMany({
      where: { userId: existingToken.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
    throw new Error('Security alert: Refresh token already used. All active sessions have been revoked. Please log in again.');
  }

  // Check expiration
  if (new Date() > existingToken.expiresAt) {
    throw new Error('Refresh token has expired. Please log in again.');
  }

  // Check user status
  if (existingToken.user.status !== 'ACTIVE') {
    throw new Error(`Account is ${existingToken.user.status.toLowerCase()}. Access denied.`);
  }

  // Atomic rotation in transaction: revoke old token, issue new token
  const newRawToken = crypto.randomBytes(40).toString('hex');
  const newTokenHash = hashRefreshToken(newRawToken);
  const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    // Revoke old token
    await tx.refreshToken.update({
      where: { id: existingToken.id },
      data: { revokedAt: new Date() }
    });

    // Create new token
    await tx.refreshToken.create({
      data: {
        userId: existingToken.userId,
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
        userAgent,
        ipAddress
      }
    });
  }, { maxWait: 10000, timeout: 30000 });

  const newAccessToken = issueAccessToken(existingToken.user);

  return {
    accessToken: newAccessToken,
    refreshToken: newRawToken,
    expiresInSeconds: 900 // 15 mins
  };
}

/**
 * Revoke refresh token on logout
 */
async function revokeRefreshToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return;
  const tokenHash = hashRefreshToken(rawToken);
  try {
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  } catch (err) {
    console.warn('[AuthService] Error revoking refresh token:', err.message);
  }
}

/**
 * Verify JWT Access Token with strict HS256 algorithm enforcement
 */
function verifyAccessToken(token) {
  const secret = getJwtSecret();
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

module.exports = {
  assertAuthSecrets,
  validateMalawianPhone,
  requestOtp,
  verifyOtp,
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  verifyAccessToken,
  hashOtp,
  hashRefreshToken,
  getOtpDailyCapPerPhone,
  getOtpDailyCapPerIp,
  getSmsDailyCapTotal,
  resetRateLimitsForTesting,
  resetCooldownForTesting,
  checkOtpRateLimits
};
