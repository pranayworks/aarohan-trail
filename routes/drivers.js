const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const dispatchService = require('../services/dispatch');
const financeService = require('../services/finance');
const settlementService = require('../services/settlements');
const reportService = require('../services/reports');
const featureFlags = require('../services/featureFlags');
const paymentManager = require('../services/payments');
const authService = require('../services/auth');
const pushNotificationService = require('../services/pushNotification');
const { requireDriverApproval, requireRole, validateBody } = require('../middleware/auth');

const router = express.Router();

const restDriverLocationSchema = z.object({
  driverId: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  accuracy: z.number().min(0).optional(),
  speed: z.number().min(0).optional()
});

const restPayoutRequestSchema = z.object({
  driverId: z.string().optional(),
  amount: z.number().positive('Payout amount must be positive'),
  provider: z.string().optional(),
  destinationPhone: z.string().min(9, 'Destination phone number required'),
  idempotencyKey: z.string().optional()
});

// 1. Discover Nearby Drivers (Spatial GPS query with unauthenticated anonymization)
router.get('/drivers/nearby', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const tier = req.query.tier;
  const radius = parseFloat(req.query.radius || req.query.radiusKm || 7.0);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Pickup lat and lng coordinates required' });
  }

  let isAuthenticated = false;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      authService.verifyAccessToken(authHeader.substring(7));
      isAuthenticated = true;
    }
  } catch (e) {
    isAuthenticated = false;
  }

  const rawDrivers = await dispatchService.findNearbyDrivers(lat, lng, tier, radius);

  const drivers = rawDrivers.map(d => {
    if (isAuthenticated) {
      return d;
    }
    return {
      id: `anon-${crypto.createHash('md5').update(String(d.driverId || d.id)).digest('hex').slice(0, 8)}`,
      driverId: `anon-${crypto.createHash('md5').update(String(d.driverId || d.id)).digest('hex').slice(0, 8)}`,
      vehicleType: d.vehicleType,
      carModel: d.carModel,
      rating: d.rating,
      location: d.location ? {
        lat: Math.round(d.location.lat * 1000) / 1000,
        lng: Math.round(d.location.lng * 1000) / 1000,
        heading: d.location.heading
      } : null,
      distanceKm: d.distanceKm,
      etaMinutes: d.etaMinutes
    };
  });

  res.json({
    pickup: { lat, lng },
    radiusKm: radius,
    count: drivers.length,
    drivers
  });
});

// 2. Driver Telemetry Update (GPS publish)
router.post('/drivers/location', requireDriverApproval, validateBody(restDriverLocationSchema), async (req, res) => {
  const driverId = (req.user.role === 'ADMIN' && req.body.driverId)
    ? req.body.driverId
    : (req.user.driverId || req.driver?.id);
  const { lat, lng, heading, accuracy, speed } = req.body;

  const MAX_COMMISSION_DEBT_MWK = parseInt(process.env.MAX_COMMISSION_DEBT_MWK, 10) || 15000;
  if (req.driver && req.driver.commissionDebtMWK > MAX_COMMISSION_DEBT_MWK) {
    return res.status(403).json({
      error: `Forbidden: Commission debt (MK ${req.driver.commissionDebtMWK.toLocaleString()}) exceeds limit of MK ${MAX_COMMISSION_DEBT_MWK.toLocaleString()}. Pay commission to go online.`,
      code: 'COMMISSION_DEBT_EXCEEDED'
    });
  }

  const updatedDriver = await dispatchService.updateDriverLocation(driverId, { lat, lng, heading, accuracy, speed });
  if (updatedDriver) {
    res.json({ success: true, driver: updatedDriver });
  } else {
    res.status(404).json({ error: 'Driver not found' });
  }
});

// 3. Driver Financial Summary (computed from PostgreSQL)
router.get('/driver/financial-summary/:driverId', async (req, res) => {
  try {
    const privileged = ['ADMIN', 'FINANCE', 'SUPPORT'].includes(req.user?.role);
    if (!privileged && req.user?.driverId !== req.params.driverId) {
      return res.status(403).json({ error: 'Forbidden: You can only view your own financial summary' });
    }
    const summary = await reportService.driverFinancialSummary(req.params.driverId);
    if (!summary) return res.status(404).json({ error: 'Driver not found' });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. Driver Commission & Earnings Summary
router.get('/driver/commission-summary', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    let driver = null;
    if (req.user.role === 'DRIVER') {
      driver = await prisma.driver.findFirst({
        where: { userId: req.user.id }
      });
    } else if (req.query.driverId && (req.user.role === 'ADMIN' || req.user.role === 'SUPPORT' || req.user.role === 'FINANCE')) {
      driver = await prisma.driver.findUnique({
        where: { id: req.query.driverId }
      });
    }

    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayTrips = await prisma.trip.findMany({
      where: {
        driverId: driver.id,
        status: 'COMPLETED',
        completedAt: { gte: todayStart }
      },
      select: { driverShareMWK: true, driverTipMWK: true }
    });

    const todayEarningsMWK = todayTrips.reduce((sum, t) => sum + (t.driverShareMWK || 0) + (t.driverTipMWK || 0), 0);
    const maxDebtLimitMWK = parseInt(process.env.MAX_COMMISSION_DEBT_MWK, 10) || 15000;
    const canGoOnline = driver.approvalStatus === 'APPROVED' && driver.commissionDebtMWK <= maxDebtLimitMWK;

    res.json({
      success: true,
      driverId: driver.id,
      commissionDebtMWK: driver.commissionDebtMWK,
      tripsCompleted: driver.tripsCompleted,
      todayEarningsMWK,
      todayTripsCount: todayTrips.length,
      maxDebtLimitMWK,
      canGoOnline,
      debtLimitExceeded: driver.commissionDebtMWK > maxDebtLimitMWK
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Submit Cash Commission Settlement (Supports /driver/settlements and /driver/cash-settlement/submit)
const handleSettlementSubmission = async (req, res) => {
  try {
    // Identity comes ONLY from the verified JWT, never from the request body.
    const driver = await prisma.driver.findFirst({ where: { userId: req.user.id } });
    if (!driver) {
      return res.status(400).json({ error: 'Driver identity required' });
    }

    const settlement = await settlementService.submit({
      driverId: driver.id,
      amountMWK: req.body.amount,
      method: req.body.provider || req.body.remittanceMethod,
      reference: req.body.mobileMoneyReference || req.body.remittanceReference || req.body.reference,
      notes: req.body.notes
    });

    if (req.app.get('io')) {
      req.app.get('io').to('ops').emit('commission:settlement_submitted', settlement);
    }
    res.json({ success: true, settlement });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
};

router.post('/driver/settlements', requireRole('DRIVER'), handleSettlementSubmission);
router.post('/driver/cash-settlement/submit', requireRole('DRIVER'), handleSettlementSubmission);

// 5. Driver Payout Request
router.post('/driver/payout/request', requireRole('DRIVER'), validateBody(restPayoutRequestSchema), async (req, res) => {
  try {
    if (!featureFlags.payoutsEnabled()) {
      return res.status(403).json({
        error: 'Driver payouts are not enabled yet. Your earnings are recorded and will be paid out when mobile money payouts launch.',
        code: 'PAYOUTS_DISABLED'
      });
    }
    const { amount, provider, destinationPhone, idempotencyKey } = req.body;
    const driverId = req.user.driverId;
    const adapter = paymentManager.getAdapter(provider || 'sandbox');
    const payout = await financeService.requestDriverPayout({
      driverId,
      amount,
      provider: adapter.name,
      destinationPhone,
      idempotencyKey,
      paymentAdapter: adapter
    });

    if (req.app.get('io')) {
      req.app.get('io').to(`driver:${driverId}`).emit('driver:payout_processed', payout);
    }
    res.json({ success: true, payout });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =========================================================================
// 6. DRIVER ONBOARDING & DOCUMENT UPLOAD (SUPABASE PRIVATE STORAGE)
// =========================================================================
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const supabaseStorage = require('../services/supabaseStorage');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: supabaseStorage.MAX_FILE_SIZE_BYTES
  },
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (supabaseStorage.ALLOWED_MIME_TYPES.includes(mime)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type "${mime}". Allowed types: JPEG, PNG, PDF`), false);
    }
  }
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds maximum allowed limit (5 MB)' });
      }
      return res.status(400).json({ error: 'File upload error: ' + err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

// Upload driver document
router.post('/driver/documents', handleUpload, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Document file required' });
    }

    const { documentType } = req.body;
    const validTypes = ['DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_REGISTRATION', 'CERTIFICATE_OF_FITNESS', 'INSURANCE_CERTIFICATE', 'DRIVER_PHOTO'];
    if (!documentType || !validTypes.includes(documentType)) {
      return res.status(400).json({ error: `Invalid document type "${documentType}". Must be one of [${validTypes.join(', ')}]` });
    }

    let driver = await prisma.driver.findFirst({
      where: { userId: req.user.id }
    });

    if (!driver) {
      return res.status(400).json({ error: 'Driver profile does not exist. Please register vehicle and profile first.' });
    }

    const uploadResult = await supabaseStorage.uploadDriverDocument({
      driverId: driver.id,
      documentType,
      file: req.file
    });

    let savedDoc = null;
    if (documentType === 'DRIVER_PHOTO') {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { avatarUrl: uploadResult.storagePath }
      });
      savedDoc = {
        type: 'DRIVER_PHOTO',
        storagePath: uploadResult.storagePath,
        status: 'PENDING'
      };
    } else {
      const existing = await prisma.driverDocument.findFirst({
        where: { driverId: driver.id, type: documentType }
      });

      if (existing) {
        savedDoc = await prisma.driverDocument.update({
          where: { id: existing.id },
          data: {
            storagePath: uploadResult.storagePath,
            status: 'PENDING',
            rejectionReason: null,
            reviewedAt: null,
            reviewedBy: null
          }
        });
      } else {
        savedDoc = await prisma.driverDocument.create({
          data: {
            driverId: driver.id,
            type: documentType,
            storagePath: uploadResult.storagePath,
            status: 'PENDING'
          }
        });
      }
    }

    const signedUrl = await supabaseStorage.getSignedUrl(uploadResult.storagePath, 900);

    return res.json({
      success: true,
      message: `${documentType} uploaded successfully`,
      document: {
        id: savedDoc.id,
        type: documentType,
        storagePath: uploadResult.storagePath,
        status: savedDoc.status || 'PENDING',
        signedUrl
      }
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// View driver documents (Strict ownership: driver can only see own documents, admin/support can view all)
router.get('/driver/documents', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Riders cannot view driver documents
    if (req.user.role === 'RIDER') {
      return res.status(403).json({ error: 'Forbidden: Riders cannot access driver documents' });
    }

    let targetDriverId = req.query.driverId || req.user.driverId;
    if (!targetDriverId) {
      const driver = await prisma.driver.findFirst({ where: { userId: req.user.id } });
      if (driver) targetDriverId = driver.id;
    }

    // Driver can strictly only view their own documents
    if (req.user.role === 'DRIVER') {
      const myDriver = await prisma.driver.findFirst({ where: { userId: req.user.id } });
      if (!myDriver || (req.query.driverId && req.query.driverId !== myDriver.id)) {
        return res.status(403).json({ error: 'Forbidden: You cannot access another driver\'s documents' });
      }
      targetDriverId = myDriver.id;
    } else if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPPORT') {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }

    if (!targetDriverId) {
      return res.json({ documents: [] });
    }

    const docs = await prisma.driverDocument.findMany({
      where: { driverId: targetDriverId },
      orderBy: { createdAt: 'desc' }
    });

    if (req.user.role === 'ADMIN' || req.user.role === 'SUPPORT') {
      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'ADMIN_DOCUMENTS_VIEWED',
            entityType: 'DRIVER',
            entityId: targetDriverId,
            details: { documentCount: docs.length },
            ipAddress: req.ip || null,
            userAgent: req.headers['user-agent'] || null
          }
        });
      } catch (auditErr) {
        console.error('[Audit] Failed to record document access:', auditErr.message);
      }
    }

    const driverUser = await prisma.driver.findUnique({
      where: { id: targetDriverId },
      include: { user: true }
    });

    const enriched = await Promise.all(docs.map(async (doc) => {
      const signedUrl = await supabaseStorage.getSignedUrl(doc.storagePath, 900);
      return {
        id: doc.id,
        type: doc.type,
        storagePath: doc.storagePath,
        status: doc.status,
        rejectionReason: doc.rejectionReason,
        signedUrl,
        createdAt: doc.createdAt
      };
    }));

    if (driverUser?.user?.avatarUrl) {
      const photoSignedUrl = await supabaseStorage.getSignedUrl(driverUser.user.avatarUrl, 900);
      enriched.push({
        id: 'avatar',
        type: 'DRIVER_PHOTO',
        storagePath: driverUser.user.avatarUrl,
        status: 'PENDING',
        signedUrl: photoSignedUrl,
        createdAt: driverUser.user.createdAt
      });
    }

    return res.json({
      success: true,
      driverId: targetDriverId,
      documents: enriched
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Raw file streaming for local offline fallback with strict ownership protection
router.get('/driver/documents/raw', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const relPath = req.query.path;
    if (!relPath || relPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const parts = relPath.split('/');
    const pathDriverId = parts[0];

    if (req.user.role === 'RIDER') {
      return res.status(403).json({ error: 'Forbidden: Riders cannot access driver documents' });
    }

    if (req.user.role === 'DRIVER') {
      const myDriver = await prisma.driver.findFirst({ where: { userId: req.user.id } });
      if (!myDriver || myDriver.id !== pathDriverId) {
        return res.status(403).json({ error: 'Forbidden: You cannot access another driver\'s documents' });
      }
    } else if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPPORT') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const baseDir = path.resolve(supabaseStorage.LOCAL_STORAGE_DIR);
    const fullPath = path.resolve(baseDir, relPath);
    if (!fullPath.startsWith(baseDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Document file not found' });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg');
    res.setHeader('Content-Type', contentType);
    return fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Driver Onboarding Status
router.get('/driver/onboarding/status', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const driver = await prisma.driver.findFirst({
      where: { userId: req.user.id },
      include: {
        vehicle: true,
        documents: true,
        user: { select: { id: true, name: true, phone: true, avatarUrl: true, emergencyContactName: true, emergencyContactPhone: true } }
      }
    });

    if (!driver) {
      return res.json({
        hasProfile: false,
        approvalStatus: 'NOT_STARTED',
        documents: []
      });
    }

    return res.json({
      hasProfile: true,
      driverId: driver.id,
      approvalStatus: driver.approvalStatus,
      rejectionReason: driver.rejectionReason,
      vehicle: driver.vehicle,
      documents: driver.documents.map(d => ({
        id: d.id,
        type: d.type,
        status: d.status,
        rejectionReason: d.rejectionReason
      })),
      avatarUrl: driver.user.avatarUrl
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

const restDeviceTokenSchema = z.object({
  token: z.string().min(10, 'FCM device token is required'),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']).optional().default('ANDROID')
});

// Register FCM Device Push Token
router.post('/driver/device-token', requireRole('DRIVER'), validateBody(restDeviceTokenSchema), async (req, res) => {
  try {
    const { token, platform } = req.body;
    const record = await pushNotificationService.registerDeviceToken({
      userId: req.user.id,
      token,
      platform
    });
    res.json({ success: true, token: record.token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
