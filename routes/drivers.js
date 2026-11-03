const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const dispatchService = require('../services/dispatch');
const financeService = require('../services/finance');
const paymentManager = require('../services/payments');
const authService = require('../services/auth');
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

  const updatedDriver = await dispatchService.updateDriverLocation(driverId, { lat, lng, heading, accuracy, speed });
  if (updatedDriver) {
    res.json({ success: true, driver: updatedDriver });
  } else {
    res.status(404).json({ error: 'Driver not found' });
  }
});

// 3. Driver Financial Summary
router.get('/driver/financial-summary/:driverId', (req, res) => {
  if (req.user?.role !== 'ADMIN' && req.user?.driverId !== req.params.driverId) {
    return res.status(403).json({ error: 'Forbidden: You can only view your own financial summary' });
  }
  const summary = financeService.getDriverFinancialSummary(req.params.driverId);
  res.json(summary);
});

// 4. Submit Cash Commission Settlement
router.post('/driver/cash-settlement/submit', requireRole('DRIVER'), (req, res) => {
  try {
    const settlement = financeService.submitCashCommissionSettlement(req.body);
    if (req.app.get('io')) {
      req.app.get('io').emit('commission:settlement_submitted', settlement);
    }
    res.json({ success: true, settlement });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Driver Payout Request
router.post('/driver/payout/request', requireRole('DRIVER'), validateBody(restPayoutRequestSchema), async (req, res) => {
  try {
    const { amount, provider, destinationPhone, idempotencyKey } = req.body;
    const driverId = req.user.driverId || req.body.driverId;
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
      req.app.get('io').emit('driver:payout_processed', payout);
    }
    res.json({ success: true, payout });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
