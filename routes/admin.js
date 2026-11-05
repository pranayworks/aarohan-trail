const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const financeService = require('../services/finance');
const dbLedger = require('../services/dbLedger');
const pricingService = require('../services/pricing');
const dispatchService = require('../services/dispatch');
const supabaseStorage = require('../services/supabaseStorage');
const { requireRole, validateBody } = require('../middleware/auth');
const { getFullTripRecord, logAdminTripAccess } = require('../services/tripRecord');

const router = express.Router();

const restPricingVersionSchema = z.object({
  versionId: z.string().optional(),
  name: z.string().optional(),
  rates: z.record(z.any()).optional()
}).passthrough();

const restPricingActivateSchema = z.object({
  versionId: z.string().min(1, 'versionId is required'),
  adminId: z.string().optional()
});

const restCashSettlementVerifySchema = z.object({
  settlementId: z.string().min(1, 'settlementId is required'),
  approved: z.boolean(),
  notes: z.string().optional()
});

// Admin Metrics
router.get('/admin/metrics', requireRole('ADMIN'), async (req, res) => {
  try {
    const finReport = financeService.getPlatformFinancialReport();
    const activeTripsCount = await prisma.trip.count({
      where: { status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] } }
    });
    const completedTripsCount = await prisma.trip.count({
      where: { status: 'COMPLETED' }
    });
    const onlineDriversCount = await prisma.driver.count({
      where: { availability: 'ONLINE' }
    });

    const ledgerAgg = await prisma.ledgerEntry.aggregate({
      where: { account: 'PLATFORM_REVENUE' },
      _sum: { amountMWK: true }
    });
    const dbRevenue = ledgerAgg._sum.amountMWK || 0;
    const platformRevenueMWK = dbRevenue > 0 ? dbRevenue : (finReport.netPlatformRevenue || 0);
    const totalVolumeMWK = finReport.totalGMV > 0 ? finReport.totalGMV : Math.round(platformRevenueMWK / 0.30);

    const sosAlertsCount = await prisma.sosEvent.count({ where: { status: 'ACTIVE' } });

    const io = req.app.get('io');
    const connectedClients = io ? io.engine?.clientsCount || 0 : 0;

    res.json({
      activeTripsCount,
      onlineDriversCount: onlineDriversCount || 0,
      completedTripsCount: completedTripsCount || finReport.totalRidesCount || 0,
      totalVolumeMWK,
      platformRevenueMWK,
      commissionRate: 0.30,
      driverShareRate: 0.70,
      cashGrossVolume: finReport.cashGrossVolume,
      digitalGrossVolume: finReport.digitalGrossVolume,
      outstandingCashCommission: finReport.outstandingCashCommission,
      completedPayoutsTotal: finReport.completedPayoutsTotal,
      connectedClients,
      emergencyAlertsCount: sosAlertsCount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/financial-report', requireRole('ADMIN'), (req, res) => {
  res.json(financeService.getPlatformFinancialReport());
});

router.get('/admin/financial-ledger', requireRole('ADMIN'), (req, res) => {
  res.json(financeService.ledger);
});

// Pricing Endpoints
router.get('/pricing/versions', async (req, res) => {
  try {
    await pricingService.syncFromDatabase();
    res.json(pricingService.getAllVersions());
  } catch (e) {
    res.json(pricingService.getAllVersions());
  }
});

router.get('/pricing/active', async (req, res) => {
  try {
    await pricingService.syncFromDatabase();
    res.json(pricingService.getActiveVersion());
  } catch (e) {
    res.json(pricingService.getActiveVersion());
  }
});

router.post('/pricing/versions', requireRole('ADMIN'), validateBody(restPricingVersionSchema), async (req, res) => {
  try {
    const version = await pricingService.createPricingVersion(req.body);
    const io = req.app.get('io');
    if (io) io.emit('pricing:version_created', version);
    res.json({ success: true, version });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pricing/activate', requireRole('ADMIN'), validateBody(restPricingActivateSchema), async (req, res) => {
  try {
    const { versionId } = req.body;
    if (!versionId) return res.status(400).json({ error: 'versionId required' });
    const activated = await pricingService.activateVersion(versionId, req.user?.id || 'ADMIN_SUPER');
    const io = req.app.get('io');
    if (io) io.emit('pricing:version_activated', activated);
    res.json({ success: true, activated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pricing/rates/:categoryId', requireRole('ADMIN'), async (req, res) => {
  try {
    const { categoryId } = req.params;
    const result = await pricingService.updateCategoryRates(categoryId, req.body, req.user?.id || 'ADMIN_SUPER');
    const io = req.app.get('io');
    if (io) io.emit('pricing:rates_updated', result);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pricing/global', requireRole('ADMIN'), async (req, res) => {
  try {
    const result = await pricingService.updateGlobalTariffs(req.body, req.user?.id || 'ADMIN_SUPER');
    const io = req.app.get('io');
    if (io) io.emit('pricing:global_updated', result);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cash Commission Verification
router.post('/admin/cash-settlement/verify', requireRole('ADMIN'), validateBody(restCashSettlementVerifySchema), (req, res) => {
  try {
    const { settlementId, approved, notes } = req.body;
    const result = financeService.verifyCashCommissionSettlement({
      settlementId,
      adminId: req.user?.id || 'ADMIN_SUPER',
      approved,
      notes
    });
    const io = req.app.get('io');
    if (io) io.emit('commission:settlement_verified', result);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin Driver Fleet List (ADMIN & SUPPORT)
router.get('/admin/drivers', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const drivers = await prisma.driver.findMany({
      include: {
        user: { select: { id: true, name: true, phone: true } },
        vehicle: true
      }
    });
    res.json(drivers.map(d => ({
      id: d.id,
      driverId: d.id,
      name: d.user?.name,
      phone: d.user?.phone,
      vehicleType: d.vehicle?.type,
      plateNumber: d.vehicle?.plateNumber,
      carModel: d.vehicle?.model,
      status: d.availability,
      approvalStatus: d.approvalStatus,
      rating: d.rating,
      totalTrips: d.totalTrips,
      currentLat: d.currentLat,
      currentLng: d.currentLng,
      lastLocationAt: d.lastLocationAt
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 1. List Pending Drivers with Documents and Signed URLs (ADMIN & SUPPORT)
router.get('/admin/drivers/pending', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const pendingDrivers = await prisma.driver.findMany({
      where: {
        approvalStatus: 'PENDING'
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            avatarUrl: true,
            emergencyContactName: true,
            emergencyContactPhone: true,
            createdAt: true
          }
        },
        vehicle: true,
        documents: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const enriched = await Promise.all(pendingDrivers.map(async (driver) => {
      const documentsWithUrls = await Promise.all(driver.documents.map(async (doc) => {
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

      let avatarSignedUrl = driver.user?.avatarUrl;
      if (driver.user?.avatarUrl && !driver.user.avatarUrl.startsWith('http')) {
        avatarSignedUrl = await supabaseStorage.getSignedUrl(driver.user.avatarUrl, 900);
      }

      return {
        id: driver.id,
        driverId: driver.id,
        userId: driver.userId,
        name: driver.user?.name,
        phone: driver.user?.phone,
        email: driver.user?.email,
        avatarUrl: avatarSignedUrl,
        emergencyContactName: driver.user?.emergencyContactName,
        emergencyContactPhone: driver.user?.emergencyContactPhone,
        approvalStatus: driver.approvalStatus,
        availability: driver.availability,
        vehicle: driver.vehicle ? {
          type: driver.vehicle.type,
          makeModel: driver.vehicle.makeModel,
          color: driver.vehicle.color,
          plateNumber: driver.vehicle.plateNumber,
          year: driver.vehicle.year
        } : null,
        documents: documentsWithUrls,
        createdAt: driver.createdAt
      };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. View Driver Documents via short-lived signed URLs (ADMIN & SUPPORT)
router.get('/admin/drivers/:driverId/documents', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { driverId } = req.params;
    const docs = await prisma.driverDocument.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' }
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

    res.json({ driverId, documents: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Approve Driver (ADMIN & SUPPORT)
router.post('/admin/drivers/:driverId/approve', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.driver.update({
        where: { id: driverId },
        data: {
          approvalStatus: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: req.user.id,
          rejectionReason: null
        }
      });

      await tx.driverDocument.updateMany({
        where: { driverId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          rejectionReason: null
        }
      });

      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'DRIVER_APPROVED',
          entityType: 'DRIVER',
          entityId: driverId,
          details: {
            driverId,
            driverName: driver.user?.name,
            driverPhone: driver.user?.phone,
            approvedByRole: req.user.role
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null
        }
      });

      return d;
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:status_changed', { driverId, approvalStatus: 'APPROVED' });
    }

    res.json({ success: true, message: 'Driver approved successfully', driver: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Reject Driver with a reason (ADMIN & SUPPORT)
router.post('/admin/drivers/:driverId/reject', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { driverId } = req.params;
    const reason = req.body?.reason || 'Verification documents do not meet safety and regulatory standards';

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.driver.update({
        where: { id: driverId },
        data: {
          approvalStatus: 'REJECTED',
          rejectionReason: reason,
          availability: 'OFFLINE'
        }
      });

      await tx.driverDocument.updateMany({
        where: { driverId },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          reviewedBy: req.user.id,
          reviewedAt: new Date()
        }
      });

      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'DRIVER_REJECTED',
          entityType: 'DRIVER',
          entityId: driverId,
          details: {
            driverId,
            reason,
            driverName: driver.user?.name,
            driverPhone: driver.user?.phone,
            rejectedByRole: req.user.role
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null
        }
      });

      return d;
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:status_changed', { driverId, approvalStatus: 'REJECTED', reason });
    }

    res.json({ success: true, message: 'Driver rejected', driver: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Suspend Driver (ADMIN & SUPPORT)
router.post('/admin/drivers/:driverId/suspend', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { driverId } = req.params;
    const reason = req.body?.reason || 'Suspended by administrative action';

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.driver.update({
        where: { id: driverId },
        data: {
          approvalStatus: 'SUSPENDED',
          availability: 'OFFLINE',
          rejectionReason: reason
        }
      });

      await tx.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'DRIVER_SUSPENDED',
          entityType: 'DRIVER',
          entityId: driverId,
          details: {
            driverId,
            reason,
            driverName: driver.user?.name,
            driverPhone: driver.user?.phone,
            suspendedByRole: req.user.role
          },
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null
        }
      });

      return d;
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('driver:status_changed', { driverId, approvalStatus: 'SUSPENDED', reason });
    }

    res.json({ success: true, message: 'Driver suspended', driver: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. List Pending Driver Commission Settlements (ADMIN, FINANCE, SUPPORT)
router.get('/admin/settlements/pending', requireRole('ADMIN', 'FINANCE', 'SUPPORT'), async (req, res) => {
  try {
    const rawSettlements = (financeService.ledger.cashSettlements || []).filter(s => s.status === 'PENDING_VERIFICATION');

    const enriched = await Promise.all(rawSettlements.map(async (s) => {
      let driver = null;
      if (s.driverId) {
        driver = await prisma.driver.findFirst({
          where: { OR: [{ id: s.driverId }, { userId: s.driverId }] },
          include: { user: { select: { name: true, phone: true } }, vehicle: true }
        });
      }
      return {
        ...s,
        driverName: driver?.user?.name || 'Driver Partner',
        driverPhone: driver?.user?.phone || 'N/A',
        currentDebtMWK: driver?.commissionDebtMWK ?? s.amount,
        plateNumber: driver?.vehicle?.plateNumber || 'N/A',
        realDriverId: driver?.id || s.driverId
      };
    }));

    res.json({
      success: true,
      count: enriched.length,
      settlements: enriched
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Approve Commission Settlement (ADMIN, FINANCE)
// "Approval writes a balanced ledger journal and reduces Driver.commissionDebtMWK in one transaction."
router.post('/admin/settlements/:settlementId/approve', requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { notes } = req.body || {};

    const rawSettlement = (financeService.ledger.cashSettlements || []).find(s => s.settlementId === settlementId);
    if (!rawSettlement) {
      return res.status(404).json({ error: `Settlement ${settlementId} not found` });
    }
    if (rawSettlement.status === 'VERIFIED') {
      return res.status(400).json({ error: 'Settlement is already verified' });
    }

    // Resolve Postgres driver ID
    let driver = await prisma.driver.findFirst({
      where: { OR: [{ id: rawSettlement.driverId }, { userId: rawSettlement.driverId }] }
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver associated with settlement not found in database' });
    }

    // Atomic transaction: write balanced ledger journal and reduce Driver.commissionDebtMWK
    const ledgerResult = await dbLedger.recordCommissionSettlement({
      driverId: driver.id,
      amountMWK: rawSettlement.amount,
      reference: rawSettlement.remittanceReference,
      settlementId: rawSettlement.settlementId,
      verifiedByUserId: req.user.id,
      notes: notes || 'Admin verified commission remittance'
    });

    // Update in-memory finance service
    financeService.verifyCashCommissionSettlement({
      settlementId: rawSettlement.settlementId,
      adminId: req.user.id,
      approved: true,
      notes
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('commission:settled', {
        settlementId,
        driverId: driver.id,
        amountMWK: rawSettlement.amount,
        newDebtMWK: ledgerResult.newDebtMWK
      });
    }

    res.json({
      success: true,
      message: 'Settlement approved, balanced ledger journal written, and driver debt reduced.',
      journalId: ledgerResult.journalId,
      driver: ledgerResult.driver,
      previousDebtMWK: ledgerResult.previousDebtMWK,
      newDebtMWK: ledgerResult.newDebtMWK,
      settledAmountMWK: ledgerResult.settledAmountMWK,
      netBalanceSum: ledgerResult.netBalanceSum,
      entriesCount: ledgerResult.entries.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Reject Commission Settlement (ADMIN, FINANCE)
router.post('/admin/settlements/:settlementId/reject', requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { settlementId } = req.params;
    const reason = req.body?.reason || req.body?.notes;
    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    const rawSettlement = (financeService.ledger.cashSettlements || []).find(s => s.settlementId === settlementId);
    if (!rawSettlement) {
      return res.status(404).json({ error: `Settlement ${settlementId} not found` });
    }
    if (rawSettlement.status === 'VERIFIED') {
      return res.status(400).json({ error: 'Cannot reject an already verified settlement' });
    }

    financeService.verifyCashCommissionSettlement({
      settlementId: rawSettlement.settlementId,
      adminId: req.user.id,
      approved: false,
      notes: reason
    });

    // Log AuditLog
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'MANUAL_ADJUSTMENT',
        entityType: 'COMMISSION_SETTLEMENT',
        entityId: settlementId,
        details: {
          settlementId,
          reason,
          driverId: rawSettlement.driverId,
          amountMWK: rawSettlement.amount
        },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('commission:rejected', { settlementId, reason });
    }

    res.json({
      success: true,
      message: 'Settlement rejected',
      reason,
      settlement: rawSettlement
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 9. TRIPS MANAGEMENT & FULL LEGAL/SAFETY AUDIT DESK (ADMIN & SUPPORT)
// ============================================================================

// 9a. List & Search Trips
router.get('/admin/trips', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { query, status, serviceType, startDate, endDate, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = {};
    if (status) where.status = status;
    if (serviceType) where.serviceType = serviceType;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (query && query.trim()) {
      const q = query.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { rider: { phone: { contains: q } } },
        { driver: { user: { phone: { contains: q } } } },
        { pickupAddress: { contains: q, mode: 'insensitive' } },
        { dropoffAddress: { contains: q, mode: 'insensitive' } }
      ];
    }

    const [trips, total] = await Promise.all([
      prisma.trip.findMany({
        where,
        include: {
          rider: { select: { id: true, name: true, phone: true } },
          driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } },
          stops: { orderBy: { sequence: 'asc' } },
          parcelDetail: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.trip.count({ where })
    ]);

    res.json({
      success: true,
      trips,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / take)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9b. CSV Export for Legal & Operations Audit
router.get('/admin/trips/export/csv', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { status, serviceType, startDate, endDate } = req.query;
    const where = {};
    if (status) where.status = status;
    if (serviceType) where.serviceType = serviceType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const trips = await prisma.trip.findMany({
      where,
      include: {
        rider: { select: { name: true, phone: true } },
        driver: { include: { user: { select: { name: true, phone: true } }, vehicle: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 2000
    });

    const headers = [
      'TripID', 'ServiceType', 'Status', 'Date', 'RiderPhone', 'DriverPhone',
      'VehiclePlate', 'Pickup', 'Destination', 'DistanceKm', 'FareMWK',
      'CommissionMWK', 'DriverShareMWK', 'PaymentMethod', 'PaymentStatus'
    ];

    const rows = trips.map(t => [
      t.id,
      t.serviceType,
      t.status,
      new Date(t.createdAt).toISOString(),
      t.rider?.phone || '',
      t.driver?.user?.phone || '',
      t.driver?.vehicle?.plateNumber || '',
      `"${(t.pickupAddress || '').replace(/"/g, '""')}"`,
      `"${(t.dropoffAddress || '').replace(/"/g, '""')}"`,
      t.distanceKm,
      t.fareMWK,
      t.commissionMWK,
      t.driverShareMWK,
      t.paymentMethod,
      t.paymentStatus
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="aarohan-trips-${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9c. Full Authoritative Trip Record (Audit-Logged)
router.get('/admin/trips/:tripId', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { tripId } = req.params;
    const record = await getFullTripRecord(tripId);
    if (!record) {
      return res.status(404).json({ error: `Trip ${tripId} not found` });
    }

    await logAdminTripAccess(
      tripId,
      req.user.id,
      'FULL_RECORD',
      req.ip || req.headers['x-forwarded-for'],
      req.headers['user-agent']
    );

    res.json({ success: true, ...record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9d. GPS Trail Viewer (Audit-Logged)
router.get('/admin/trips/:tripId/gps-trail', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { tripId } = req.params;
    const points = await prisma.tripLocationPoint.findMany({
      where: { tripId },
      orderBy: { recordedAt: 'asc' }
    });

    await logAdminTripAccess(
      tripId,
      req.user.id,
      'GPS_TRAIL',
      req.ip || req.headers['x-forwarded-for'],
      req.headers['user-agent']
    );

    res.json({ success: true, tripId, count: points.length, points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9e. Chat History Viewer (Audit-Logged)
router.get('/admin/trips/:tripId/chat', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { tripId } = req.params;
    const messages = await prisma.chatMessage.findMany({
      where: { tripId },
      include: { sender: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' }
    });

    await logAdminTripAccess(
      tripId,
      req.user.id,
      'CHAT',
      req.ip || req.headers['x-forwarded-for'],
      req.headers['user-agent']
    );

    res.json({ success: true, tripId, count: messages.length, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
