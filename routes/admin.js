const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const financeService = require('../services/finance');
const pricingService = require('../services/pricing');
const dispatchService = require('../services/dispatch');
const { requireRole, validateBody } = require('../middleware/auth');

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
router.get('/pricing/versions', (req, res) => {
  res.json(pricingService.getAllVersions());
});

router.get('/pricing/active', (req, res) => {
  res.json(pricingService.getActiveVersion());
});

router.post('/pricing/versions', requireRole('ADMIN'), validateBody(restPricingVersionSchema), (req, res) => {
  try {
    const version = pricingService.createPricingVersion(req.body);
    res.json({ success: true, version });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pricing/activate', requireRole('ADMIN'), validateBody(restPricingActivateSchema), (req, res) => {
  try {
    const { versionId } = req.body;
    if (!versionId) return res.status(400).json({ error: 'versionId required' });
    const activated = pricingService.activateVersion(versionId, req.user?.id || 'ADMIN_SUPER');
    const io = req.app.get('io');
    if (io) io.emit('pricing:version_activated', activated);
    res.json({ success: true, activated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/pricing/rates/:categoryId', requireRole('ADMIN'), (req, res) => {
  try {
    const { categoryId } = req.params;
    const result = pricingService.updateCategoryRates(categoryId, req.body, req.user?.id || 'ADMIN_SUPER');
    const io = req.app.get('io');
    if (io) io.emit('pricing:rates_updated', result);
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

// Admin Driver Fleet List
router.get('/admin/drivers', requireRole('ADMIN'), async (req, res) => {
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

module.exports = router;
