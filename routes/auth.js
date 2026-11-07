// ============================================================================
// AAROHAN AUTHENTICATION ROUTER • LILONGWE, MALAWI
// ============================================================================

const express = require('express');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');
const emailAuth = require('../services/emailAuth');
const { authMode } = require('../services/featureFlags');
const { requireAuth, validateBody } = require('../middleware/auth');

const router = express.Router();

// Only one sign-in method is open at a time (AUTH_MODE). The other one answers 404, so a demo that
// uses email codes can never be used to trigger SMS sends, and vice versa.
function requireMode(mode) {
  return (req, res, next) => {
    if (authMode() === mode) return next();
    return res.status(404).json({ error: mode === 'email' ? 'Email login is not enabled.' : 'Phone login is not enabled.' });
  };
}

// Track admin failed password attempts and lockouts: phone -> { attempts, lockedUntil }
const adminLoginAttempts = new Map();

// Admin login rate limiter: max 10 requests per 15 minutes per IP
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin login attempts from this IP address. Please wait 15 minutes.' }
});

// ---------------------------------------------------------------------------
// ZOD VALIDATION SCHEMAS
// ---------------------------------------------------------------------------
const otpRequestSchema = z.object({
  phone: z.string().min(9, 'Phone number is required')
});

const otpVerifySchema = z.object({
  phone: z.string().min(9, 'Phone number is required'),
  otp: z.string().length(6, 'Verification code must be 6 digits')
});

const adminLoginSchema = z.object({
  phone: z.string().min(9, 'Admin phone number is required'),
  password: z.string().min(6, 'Password is required'),
  otp: z.string().length(6, 'Verification code must be 6 digits')
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token is required')
});

const driverRegisterSchema = z.object({
  name: z.string().min(2, 'Name is required').optional(),
  makeModel: z.string().min(2, 'Make and model required'),
  color: z.string().min(2, 'Color required'),
  plateNumber: z.string().min(3, 'Plate number required'),
  vehicleType: z.enum(['MOTO', 'AUTO', 'CAB']),
  year: z.number().int().min(1970).max(new Date().getFullYear() + 1).optional(),
  emergencyContact: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional()
});


// ---------------------------------------------------------------------------
// 1. POST /api/auth/otp/request
// ---------------------------------------------------------------------------
router.post('/otp/request', requireMode('phone'), validateBody(otpRequestSchema), async (req, res) => {
  try {
    const result = await authService.requestOtp(req.body.phone, req.ip);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 2. POST /api/auth/otp/verify (Riders only - never accept role from client)
// ---------------------------------------------------------------------------
router.post('/otp/verify', requireMode('phone'), validateBody(otpVerifySchema), async (req, res) => {
  try {
    const { phone, otp } = req.body;
    await authService.verifyOtp(phone, otp, req.ip);

    // Look up or create user (strictly as RIDER)
    let user = await prisma.user.findUnique({
      where: { phone },
      include: { driverProfile: true, wallet: true }
    });

    if (user) {
      if (user.status !== 'ACTIVE') {
        return res.status(403).json({ error: `Account is ${user.status.toLowerCase()}. Access denied.` });
      }

      // Security Invariant: Admin accounts CANNOT log in via standard OTP verify alone
      if (user.role === 'ADMIN') {
        return res.status(403).json({
          error: 'Administrative accounts require dual-factor password authentication via /api/auth/admin/login.'
        });
      }
    } else {
      // Create new user strictly as RIDER
      user = await prisma.user.create({
        data: {
          phone,
          name: 'Passenger ' + phone.slice(-4),
          role: 'RIDER', // Never accept role from client
          status: 'ACTIVE'
        },
        include: { driverProfile: true, wallet: true }
      });

      // Initialize Wallet
      await prisma.wallet.create({
        data: {
          userId: user.id,
          balanceMWK: 0
        }
      });

      // Record Audit Log
      await prisma.auditLog.create({
        data: {
          user: { connect: { id: user.id } },
          action: 'USER_REGISTER',
          entityType: 'USER',
          entityId: user.id,
          details: { phone, role: 'RIDER' },
          ipAddress: req.ip
        }
      });
    }

    // Issue tokens
    const accessToken = authService.issueAccessToken(user);
    const { rawRefreshToken } = await authService.issueRefreshToken(
      user.id,
      req.headers['user-agent'] || null,
      req.ip
    );

    return res.json({
      success: true,
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        status: user.status,
        driverProfile: user.driverProfile ? {
          id: user.driverProfile.id,
          approvalStatus: user.driverProfile.approvalStatus,
          availability: user.driverProfile.availability
        } : null
      }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3. POST /api/auth/admin/login (OTP + Password required)
// ---------------------------------------------------------------------------
router.post('/admin/login', adminLoginLimiter, requireMode('phone'), validateBody(adminLoginSchema), async (req, res) => {
  try {
    const { phone, password, otp } = req.body;

    // Check if admin is currently locked out
    const lockRecord = adminLoginAttempts.get(phone);
    if (lockRecord && lockRecord.lockedUntil && Date.now() < lockRecord.lockedUntil) {
      const remainingMins = Math.ceil((lockRecord.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Admin login locked due to repeated failed password attempts. Try again in ${remainingMins} minute(s).` });
    }

    // Verify OTP first
    await authService.verifyOtp(phone, otp, req.ip);

    // Fetch Admin User
    const user = await prisma.user.findUnique({
      where: { phone },
      include: { wallet: true }
    });

    if (!user || user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied: User is not an authorized administrator.' });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: `Admin account is ${user.status.toLowerCase()}. Access denied.` });
    }

    if (!user.passwordHash) {
      return res.status(500).json({ error: 'Admin account has no password configured. Run scripts/create-admin.js.' });
    }

    // Compare Password
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      const currentAttempts = (lockRecord ? lockRecord.attempts : 0) + 1;
      if (currentAttempts >= 5) {
        const lockedUntil = Date.now() + 15 * 60 * 1000;
        adminLoginAttempts.set(phone, { attempts: currentAttempts, lockedUntil });
        await prisma.auditLog.create({
          data: {
            user: { connect: { id: user.id } },
            action: 'OTP_LOCKED',
            entityType: 'USER',
            entityId: user.id,
            details: { type: 'ADMIN_PASSWORD_LOCKOUT', reason: 'Exceeded 5 failed admin password attempts', lockedUntil: new Date(lockedUntil) },
            ipAddress: req.ip
          }
        });
        return res.status(429).json({ error: 'Admin account locked for 15 minutes: Maximum failed password attempts (5) exceeded.' });
      } else {
        adminLoginAttempts.set(phone, { attempts: currentAttempts, lockedUntil: null });
        const remaining = 5 - currentAttempts;
        return res.status(401).json({ error: `Invalid administrative password credentials. ${remaining} attempt(s) remaining before lockout.` });
      }
    }

    // Password valid -> Clear failed attempts
    adminLoginAttempts.delete(phone);

    // Issue tokens
    const accessToken = authService.issueAccessToken(user);
    const { rawRefreshToken } = await authService.issueRefreshToken(
      user.id,
      req.headers['user-agent'] || null,
      req.ip
    );

    await prisma.auditLog.create({
      data: {
        user: { connect: { id: user.id } },
        action: 'USER_LOGIN',
        entityType: 'USER',
        entityId: user.id,
        details: { role: 'ADMIN' },
        ipAddress: req.ip
      }
    });

    return res.json({
      success: true,
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3b. EMAIL LOGIN (AUTH_MODE=email): email is the verified identity
// ---------------------------------------------------------------------------
const emailRequestSchema = z.object({ email: z.string().min(5).max(254) });
const emailVerifySchema = z.object({
  email: z.string().min(5).max(254),
  otp: z.string().length(6, 'Verification code must be 6 digits'),
  name: z.string().max(80).optional(),
  phone: z.string().max(20).optional()
});
const adminEmailLoginSchema = z.object({
  email: z.string().min(5).max(254),
  password: z.string().min(6).max(200),
  otp: z.string().length(6, 'Verification code must be 6 digits')
});
const sendAuthError = (res, err) =>
  res.status(err.statusCode || 400).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });

router.post('/email/otp/request', requireMode('email'), validateBody(emailRequestSchema), async (req, res) => {
  try {
    return res.json(await emailAuth.requestEmailOtp(req.body.email, req.ip));
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/email/otp/verify', requireMode('email'), validateBody(emailVerifySchema), async (req, res) => {
  try {
    return res.json(await emailAuth.loginWithEmail({
      email: req.body.email,
      otp: req.body.otp,
      name: req.body.name,
      phone: req.body.phone,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    }));
  } catch (err) {
    return sendAuthError(res, err);
  }
});

router.post('/admin/email-login', adminLoginLimiter, requireMode('email'), validateBody(adminEmailLoginSchema), async (req, res) => {
  try {
    return res.json(await emailAuth.adminEmailLogin({
      email: req.body.email,
      password: req.body.password,
      otp: req.body.otp,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    }));
  } catch (err) {
    return sendAuthError(res, err);
  }
});

// ---------------------------------------------------------------------------
// 4. POST /api/auth/refresh (Rotating refresh token with replay detection)
// ---------------------------------------------------------------------------
router.post('/refresh', validateBody(refreshTokenSchema), async (req, res) => {
  try {
    const result = await authService.rotateRefreshToken(
      req.body.refreshToken,
      req.headers['user-agent'] || null,
      req.ip
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. POST /api/auth/logout (Revoke refresh token)
// ---------------------------------------------------------------------------
router.post('/logout', validateBody(refreshTokenSchema), async (req, res) => {
  try {
    await authService.revokeRefreshToken(req.body.refreshToken);
    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 6. POST /api/auth/driver/register (Authenticated rider registers as driver; status PENDING)
// ---------------------------------------------------------------------------
router.post('/driver/register', requireAuth, validateBody(driverRegisterSchema), async (req, res) => {
  try {
    const existingDriver = await prisma.driver.findFirst({
      where: { userId: req.user.id }
    });

    if (existingDriver) {
      return res.status(400).json({
        error: `Driver application already exists with status ${existingDriver.approvalStatus}.`,
        driverId: existingDriver.id,
        approvalStatus: existingDriver.approvalStatus
      });
    }

    const { makeModel, color, plateNumber, vehicleType, year, name, emergencyContact, emergencyContactName, emergencyContactPhone } = req.body;

    // Check plate number uniqueness
    const existingPlate = await prisma.vehicle.findUnique({
      where: { plateNumber }
    });
    if (existingPlate) {
      return res.status(400).json({ error: `Vehicle with plate number ${plateNumber} is already registered.` });
    }

    // Create Driver profile (PENDING status) and Vehicle
    const driver = await prisma.$transaction(async (tx) => {
      const createdDriver = await tx.driver.create({
        data: {
          userId: req.user.id,
          approvalStatus: 'PENDING', // PENDING until admin approval
          availability: 'OFFLINE'
        }
      });

      await tx.vehicle.create({
        data: {
          driverId: createdDriver.id,
          type: vehicleType,
          makeModel,
          color,
          plateNumber,
          year: year || null
        }
      });

      const userUpdateData = { role: 'DRIVER' };
      if (name) userUpdateData.name = name;
      if (emergencyContactName) userUpdateData.emergencyContactName = emergencyContactName;
      if (emergencyContactPhone) userUpdateData.emergencyContactPhone = emergencyContactPhone;
      if (emergencyContact && !emergencyContactName) {
        userUpdateData.emergencyContactName = emergencyContact;
        userUpdateData.emergencyContactPhone = emergencyContact;
      }

      await tx.user.update({
        where: { id: req.user.id },
        data: userUpdateData
      });

      await tx.auditLog.create({
        data: {
          user: { connect: { id: req.user.id } },
          action: 'DRIVER_REGISTERED',
          entityType: 'DRIVER',
          entityId: createdDriver.id,
          details: { plateNumber, vehicleType }
        }
      });

      return createdDriver;
    }, { maxWait: 10000, timeout: 30000 });

    return res.json({
      success: true,
      message: 'Driver registration submitted successfully. Your profile is PENDING administrator verification.',
      driver: {
        id: driver.id,
        approvalStatus: driver.approvalStatus,
        availability: driver.availability
      }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 7. GET /api/auth/me (Returns authoritative caller profile)
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        driverProfile: { include: { vehicle: true } },
        wallet: true
      }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email || null,
        phone: user.phone,
        name: user.name,
        role: user.role,
        status: user.status,
        kycTier: user.kycTier,
        walletBalanceMWK: user.wallet ? user.wallet.balanceMWK : 0,
        driverProfile: user.driverProfile ? {
          id: user.driverProfile.id,
          approvalStatus: user.driverProfile.approvalStatus,
          availability: user.driverProfile.availability,
          rating: user.driverProfile.rating,
          tripsCompleted: user.driverProfile.tripsCompleted,
          commissionDebtMWK: user.driverProfile.commissionDebtMWK,
          vehicle: user.driverProfile.vehicle ? {
            type: user.driverProfile.vehicle.type,
            makeModel: user.driverProfile.vehicle.makeModel,
            plateNumber: user.driverProfile.vehicle.plateNumber,
            color: user.driverProfile.vehicle.color
          } : null
        } : null
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
