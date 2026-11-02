require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const cors = require('cors');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

const pricingService = require('./services/pricing');
const locationService = require('./services/location');
const dispatchService = require('./services/dispatch');
const financeService = require('./services/finance');
const paymentManager = require('./services/payments');
const notificationService = require('./services/notifications');
const prisma = require('./lib/prisma');
const dbLedger = require('./services/dbLedger');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Function to get local Wi-Fi / LAN IPv4 address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIpAddress();

// =========================================================================
// TEMPORARY DEV AUTH - STEP 2 ONLY (Will be replaced in Step 3 by JWT Auth)
// =========================================================================
async function temporaryDevAuth(req, res, next) {
  try {
    const devUserId = req.headers['x-dev-user-id'] || req.headers['x-user-id'] || req.query.userId;
    const devRole = req.headers['x-dev-role'] || req.query.role || 'RIDER';

    if (devUserId) {
      req.user = await prisma.user.findUnique({
        where: { id: devUserId },
        include: { wallet: true, driverProfile: { include: { vehicle: true } } }
      });
      if (req.user) {
        req.userId = req.user.id;
        req.userRole = req.user.role;
        return next();
      }
    }

    // Default fallback to seeded demo accounts for manual browser exploration
    const phone = devRole === 'DRIVER' ? '+265995541122' : '+265991234567';
    req.user = await prisma.user.findUnique({
      where: { phone },
      include: { wallet: true, driverProfile: { include: { vehicle: true } } }
    });
    if (req.user) {
      req.userId = req.user.id;
      req.userRole = req.user.role;
    }
    next();
  } catch (err) {
    console.error('[TemporaryDevAuth] Auth lookup error:', err.message);
    next();
  }
}

// =========================================================================
// STALE TRIPS WATCHDOG (Moves REQUESTED/OFFERED trips > 3 mins to NO_DRIVERS)
// Enforces that unique_active_trip_per_rider partial index never locks riders
// =========================================================================
async function expireStaleTrips() {
  try {
    const cutoff = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes threshold
    const staleTrips = await prisma.trip.findMany({
      where: {
        status: { in: ['REQUESTED', 'OFFERED'] },
        createdAt: { lt: cutoff }
      }
    });

    for (const trip of staleTrips) {
      await prisma.$transaction(async (tx) => {
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            status: 'NO_DRIVERS',
            cancelledBy: 'SYSTEM',
            cancelReason: 'Dispatch timeout: No drivers accepted within 3 minutes'
          }
        });
        await tx.tripStatusHistory.create({
          data: {
            tripId: trip.id,
            fromStatus: trip.status,
            status: 'NO_DRIVERS',
            changedBy: 'SYSTEM',
            reason: 'Dispatch timeout: No drivers accepted within 3 minutes'
          }
        });
      }, { maxWait: 10000, timeout: 30000 });
      io.to(`trip:${trip.id}`).emit('trip:expired', { tripId: trip.id, status: 'NO_DRIVERS' });
      io.emit('trip:expired', { tripId: trip.id, status: 'NO_DRIVERS' });
    }
    return staleTrips;
  } catch (err) {
    console.error('[StaleTripWatchdog] Error:', err.message);
    return [];
  }
}

// Run stale trip watchdog every 30 seconds
const staleTripInterval = setInterval(expireStaleTrips, 30000);

// In-memory operational desk cache for dynamic surge & support desk
const operationalState = {
  surgeMultipliers: {
    'Gateway Mall': 1.4,
    'Area 3 Commercial': 1.3,
    'Old Town Market': 1.2,
    'Area 47 Sector 3': 1.0,
    'Bingu Stadium': 1.1
  },
  supportTickets: [
    {
      id: 'MW-8821',
      user: 'Chisomo Banda',
      issue: 'Payment Dispute (Duplicate Airtel Money Entry)',
      amount: 3200,
      status: 'Under Review',
      assigned: 'Lilongwe Finance Team',
      updated: '1 hour ago'
    }
  ]
};

// Middleware
app.use(cors());
app.use(express.json());

// Favicon handler (prevents 404 console errors in browsers)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve static apps with no-cache in local development to guarantee fresh scripts
const noCacheStatic = {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
};

app.use('/rider', express.static(path.join(__dirname, 'rider'), noCacheStatic));
app.use('/driver', express.static(path.join(__dirname, 'driver'), noCacheStatic));
app.use('/admin', express.static(path.join(__dirname, 'admin'), noCacheStatic));
app.use('/shared', express.static(path.join(__dirname, 'shared'), noCacheStatic));

// Master ecosystem dashboard at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Network Info & QR Code for Phone Installation
app.get('/api/network-info', async (req, res) => {
  const riderUrl = `http://${LOCAL_IP}:${PORT}/rider/`;
  const driverUrl = `http://${LOCAL_IP}:${PORT}/driver/`;
  const adminUrl = `http://${LOCAL_IP}:${PORT}/admin/`;

  try {
    const qrDataUri = await QRCode.toDataURL(riderUrl, {
      margin: 2,
      width: 320,
      color: {
        dark: '#004328',
        light: '#ffffff'
      }
    });

    res.json({
      localIp: LOCAL_IP,
      port: PORT,
      riderUrl,
      driverUrl,
      adminUrl,
      qrDataUri
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR Code' });
  }
});

// API: Get current active trip for rider or driver from database
app.get('/api/trips/active', temporaryDevAuth, async (req, res) => {
  try {
    const activeTrip = await prisma.trip.findFirst({
      where: {
        OR: [
          { riderId: req.userId },
          { driver: { userId: req.userId } }
        ],
        status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
      },
      include: {
        rider: { select: { id: true, name: true, phone: true } },
        driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } }
      }
    });
    res.json({ activeTrip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get Map Configuration & Public Keys
app.get('/api/map-config', (req, res) => {
  res.json({
    provider: process.env.MAP_PROVIDER || 'carto',
    apiKey: process.env.MAP_API_KEY || '',
    mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || '',
    maptilerKey: process.env.MAPTILER_API_KEY || '',
    availableProviders: [
      { id: 'carto', name: 'CartoDB Voyager (Default / Free)', requiresKey: false, desc: 'Pastel Google-Maps styling, zero key required' },
      { id: 'mapbox', name: 'Mapbox Streets & Navigation', requiresKey: true, desc: 'High-detail vector/raster tiles (Requires pk.xxx token)' },
      { id: 'maptiler', name: 'MapTiler Streets v2', requiresKey: true, desc: 'Fast OpenStreetMap vector tiles (Requires MapTiler key)' }
    ]
  });
});

// =============================================================
// AAROHAN REAL-TIME PLATFORM ENDPOINTS (PHASES 2-12)
// =============================================================

// 1. Authoritative Road Routing & Dynamic Pricing Quote (Phase 4 & 5)
app.post('/api/rides/quote', async (req, res) => {
  try {
    const pickup = req.body.pickup;
    const destination = req.body.destination || req.body.dropoff;
    const surgeMultiplier = req.body.surgeMultiplier;

    if (!pickup || !destination || isNaN(pickup.lat) || isNaN(destination.lat)) {
      return res.status(400).json({ error: 'Valid pickup and destination coordinates are required' });
    }

    // Resolve human-readable place titles if missing
    if (!pickup.name || pickup.name === 'Current Position') {
      const rev = await locationService.reverseGeocode(pickup.lat, pickup.lng);
      pickup.name = rev.title || rev.displayName;
    }
    if (!destination.name) {
      const rev = await locationService.reverseGeocode(destination.lat, destination.lng);
      destination.name = rev.title || rev.displayName;
    }

    // Fetch actual road route (Mapbox Directions API)
    const route = await locationService.getRoadRoute(pickup, destination);

    // Calculate server-authoritative fare quote
    const quote = pricingService.generateQuote({
      pickup,
      destination,
      distanceKm: route.distanceKm,
      durationMins: route.durationMins,
      routeGeometry: route.polyline,
      surgeMultiplier: surgeMultiplier || 1.0
    });

    res.json({
      success: true,
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
      route: {
        distanceKm: route.distanceKm,
        durationMins: route.durationMins,
        polyline: route.polyline,
        summary: route.summary,
        provider: route.provider
      },
      tiers: quote.tiers,
      pickup: quote.pickup,
      destination: quote.destination,
      quote
    });
  } catch (err) {
    console.error('[PricingQuote] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to calculate route and fare quote' });
  }
});

// 2. Real-Time Reverse Geocoding: Coordinates -> Street Address (Phase 2 & 3)
app.get('/api/places/reverse', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'lat and lng query parameters required' });
    }
    const result = await locationService.reverseGeocode(lat, lng);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Real-Time Forward Geocoding & Autocomplete for Malawi (Phase 3)
app.get('/api/places/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const results = await locationService.searchPlaces(q, lat, lng);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Real Nearby Drivers Discovery (Phase 6: Spatial GPS Filter)
app.get('/api/drivers/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const tier = req.query.tier;
  const radius = parseFloat(req.query.radius) || 7.0;

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Pickup lat and lng coordinates required' });
  }

  const drivers = dispatchService.findNearbyDrivers(lat, lng, tier, radius);
  res.json({
    pickup: { lat, lng },
    radiusKm: radius,
    count: drivers.length,
    drivers
  });
});

// 5. Driver Telemetry Update (Phase 2 & 7: GPS publish)
app.post('/api/drivers/location', async (req, res) => {
  const { driverId, lat, lng, heading, accuracy, speed } = req.body;
  if (!driverId || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'driverId, lat and lng required' });
  }

  const updatedDriver = dispatchService.updateDriverLocation(driverId, { lat, lng, heading, accuracy, speed });
  if (updatedDriver) {
    try {
      await prisma.driver.updateMany({
        where: { OR: [{ id: driverId }, { user: { phone: driverId } }] },
        data: {
          currentLat: parseFloat(lat),
          currentLng: parseFloat(lng),
          currentHeading: parseFloat(heading) || null,
          lastLocationAt: new Date()
        }
      });
    } catch (e) {
      // Driver telemetry logged in dispatchService
    }
    io.emit('trip:driver_moved', updatedDriver.location);
    res.json({ success: true, driver: updatedDriver });
  } else {
    res.status(404).json({ error: 'Driver not found' });
  }
});

// In-memory saved places store for local dev
let savedPlacesList = [
  { id: 'PLC-home', label: 'Home', name: 'Area 47 Sector 3', address: 'Area 47 Sector 3, Kaunda Road', lat: -13.9632, lng: 33.7741 },
  { id: 'PLC-work', label: 'Work', name: 'Capital City Centre', address: 'Capital City Centre, Robert Mugabe Cres', lat: -13.9512, lng: 33.7891 }
];

// 6. User Saved Places (Phase 8: Home, Work, Custom)
app.get('/api/user/saved-places', (req, res) => {
  res.json(savedPlacesList);
});

app.post('/api/user/saved-places', (req, res) => {
  const { label, name, address, lat, lng } = req.body;
  if (!name || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'name, lat, and lng are required' });
  }

  const newPlace = {
    id: 'PLC-' + Date.now().toString(36),
    label: label || 'Custom',
    name,
    address: address || name,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    createdAt: Date.now()
  };

  if (label && ['Home', 'Work'].includes(label)) {
    savedPlacesList = savedPlacesList.filter(p => p.label !== label);
  }
  savedPlacesList.push(newPlace);
  res.json({ success: true, savedPlace: newPlace, savedPlaces: savedPlacesList });
});

app.delete('/api/user/saved-places/:id', (req, res) => {
  savedPlacesList = savedPlacesList.filter(p => p.id !== req.params.id);
  res.json({ success: true, savedPlaces: savedPlacesList });
});

// 7. Frequent Destinations (Phase 8: dynamically calculated from real completed trips)
app.get('/api/user/frequent-places', async (req, res) => {
  try {
    const completedTrips = await prisma.trip.findMany({
      where: { status: 'COMPLETED' },
      select: { dropoffAddress: true },
      take: 20
    });

    const counts = new Map();
    completedTrips.forEach(t => {
      const dest = (t.dropoffAddress || '').split(',')[0].trim();
      if (dest) counts.set(dest, (counts.get(dest) || 0) + 1);
    });

    // Fallback baseline for initial fresh state
    if (counts.size === 0) {
      counts.set('Gateway Mall', 8);
      counts.set('Area 4 Industrial', 5);
      counts.set('Kamuzu Central Hospital', 3);
    }

    const frequent = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json(frequent);
  } catch (err) {
    res.json([
      { name: 'Gateway Mall', count: 8 },
      { name: 'Area 4 Industrial', count: 5 },
      { name: 'Kamuzu Central Hospital', count: 3 }
    ]);
  }
});

// 8. Admin Real-Time Metrics & Management (AArohan 30% Platform Commission Policy)
app.get('/api/admin/metrics', async (req, res) => {
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

    res.json({
      activeTripsCount,
      onlineDriversCount: onlineDriversCount || Array.from(dispatchService.drivers.values()).filter(d => d.status === 'ONLINE').length,
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

app.get('/api/admin/financial-report', (req, res) => {
  res.json(financeService.getPlatformFinancialReport());
});

app.get('/api/admin/financial-ledger', (req, res) => {
  res.json(financeService.ledger);
});

// Admin Pricing Engine Endpoints
app.get('/api/pricing/versions', (req, res) => {
  res.json(pricingService.getAllVersions());
});

app.get('/api/pricing/active', (req, res) => {
  res.json(pricingService.getActiveVersion());
});

app.post('/api/pricing/versions', (req, res) => {
  try {
    const version = pricingService.createPricingVersion(req.body);
    res.json({ success: true, version });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/pricing/activate', (req, res) => {
  try {
    const { versionId, adminId } = req.body;
    if (!versionId) return res.status(400).json({ error: 'versionId required' });
    const activated = pricingService.activateVersion(versionId, adminId || 'ADMIN_SUPER');
    io.emit('pricing:version_activated', activated);
    res.json({ success: true, activated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/pricing/rates/:categoryId', (req, res) => {
  try {
    const { categoryId } = req.params;
    const result = pricingService.updateCategoryRates(categoryId, req.body, req.body.adminId || 'ADMIN_SUPER');
    io.emit('pricing:rates_updated', result);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Notifications & SMS / WhatsApp Gateway Endpoints
app.get('/api/notifications/history', (req, res) => {
  res.json({ success: true, history: notificationService.getRecentHistory() });
});

app.post('/api/notifications/test', async (req, res) => {
  try {
    const { to, message, channel, urgent } = req.body;
    const result = await notificationService.sendMessage({ to, message, channel, urgent });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Driver Financial & Payout Endpoints
app.get('/api/driver/financial-summary/:driverId', (req, res) => {
  const summary = financeService.getDriverFinancialSummary(req.params.driverId);
  res.json(summary);
});

app.post('/api/driver/cash-settlement/submit', (req, res) => {
  try {
    const settlement = financeService.submitCashCommissionSettlement(req.body);
    io.emit('commission:settlement_submitted', settlement);
    res.json({ success: true, settlement });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/cash-settlement/verify', (req, res) => {
  try {
    const { settlementId, adminId, approved, notes } = req.body;
    const result = financeService.verifyCashCommissionSettlement({ settlementId, adminId, approved, notes });
    io.emit('commission:settlement_verified', result);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/driver/payout/request', async (req, res) => {
  try {
    const { driverId, amount, provider, destinationPhone, idempotencyKey } = req.body;
    const adapter = paymentManager.getAdapter(provider || 'sandbox');
    const payout = await financeService.requestDriverPayout({
      driverId,
      amount,
      provider: adapter.name,
      destinationPhone,
      idempotencyKey,
      paymentAdapter: adapter
    });

    io.emit('driver:payout_processed', payout);
    res.json({ success: true, payout });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Digital Payment Collection Endpoints
app.post('/api/payments/initiate', async (req, res) => {
  try {
    const { amount, currency, phone, reference, provider, idempotencyKey } = req.body;
    const adapter = paymentManager.getAdapter(provider || 'sandbox');
    const result = await adapter.initiateCollection({
      amount,
      currency: currency || 'MWK',
      phone,
      reference,
      idempotencyKey
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/payments/verify/:reference', async (req, res) => {
  try {
    const provider = req.query.provider || 'sandbox';
    const adapter = paymentManager.getAdapter(provider);
    const result = await adapter.verifyPayment(req.params.reference);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/payments/webhook/:provider', async (req, res) => {
  try {
    const adapter = paymentManager.getAdapter(req.params.provider);
    const signature = req.headers['x-webhook-signature'] || req.headers['authorization'];
    const result = await adapter.handleWebhook(req.body, signature);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Authoritative Ride Completion Endpoint
app.post('/api/rides/complete', async (req, res) => {
  try {
    const { rideId, driverTip, paymentMethod } = req.body;
    if (!rideId) return res.status(400).json({ error: 'rideId is required' });

    const completion = dispatchService.completeTrip(rideId, { driverTip, paymentMethod });
    
    // Settle in database with double-entry ledger if trip exists in DB
    let dbResult = null;
    try {
      dbResult = await dbLedger.settleRide({
        tripId: rideId,
        paymentMethod: paymentMethod || 'CASH',
        driverTipMWK: driverTip || 0,
        changedBy: 'DRIVER'
      });
    } catch (e) {
      // Handled in dispatchService for in-memory / mock rides
    }

    io.emit('trip:completed', completion);
    res.json({ success: true, ...completion, dbTrip: dbResult?.trip });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/drivers', (req, res) => {
  res.json(Array.from(dispatchService.drivers.values()));
});

// Function to compute spherical distance in km using Haversine formula
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(1));
}

// Master Malawi Gazetteer (Specific local businesses, printing companies, industrial areas & landmarks)
const MALAWI_LOCATIONS = [
  {
    name: 'EPTL Malawi (Entire Printers & Traders Limited)',
    area: 'Plot 4/122, Murray Rd, Area 4 Industrial, Lilongwe, Malawi',
    category: 'Printing, Packaging & Corporate Branding',
    icon: 'print',
    lat: -13.9812,
    lng: 33.7745,
    tags: ['eptl', 'printing', 'printers', 'entire printers', 'packaging', 'traders', 'promotional', 'branding', 'area 4', 'murray', 'offset', 'dtf']
  },
  {
    name: 'Bingu National Stadium',
    area: 'near Area 49, Kaunda Rd, Lilongwe, Malawi',
    category: 'Sports & Concert Arena',
    icon: 'stadium',
    lat: -13.9482,
    lng: 33.7431,
    tags: ['bingu', 'stadium', 'sports', 'area 49', 'kaunda']
  },
  {
    name: 'City Centre (Capital Hill)',
    area: 'Independence Drive, Area 20, Lilongwe, Malawi',
    category: 'Government Ministries & Diplomatic Zone',
    icon: 'account_balance',
    lat: -13.9554,
    lng: 33.7872,
    tags: ['city centre', 'capital hill', 'government', 'ministries', 'area 20']
  },
  {
    name: 'Old Town Mall & Market',
    area: 'Kamuzu Procession Rd, Area 2, Lilongwe, Malawi',
    category: 'Shopping & Local Markets',
    icon: 'storefront',
    lat: -13.9856,
    lng: 33.7745,
    tags: ['old town', 'market', 'area 2', 'kamuzu procession']
  },
  {
    name: 'Kamuzu Central Hospital',
    area: 'Area 33, Mzimba St, Lilongwe, Malawi',
    category: 'Central Referral Hospital',
    icon: 'local_hospital',
    lat: -13.9790,
    lng: 33.7840,
    tags: ['kamuzu hospital', 'hospital', 'medical', 'kch', 'area 33']
  },
  {
    name: 'Crossroads Hotel & Complex',
    area: 'M1 / Chilambula Rd, Area 3, Lilongwe, Malawi',
    category: 'Hotels & Business Centre',
    icon: 'hotel',
    lat: -13.9760,
    lng: 33.7710,
    tags: ['crossroads', 'hotel', 'area 3', 'chilambula']
  },
  {
    name: 'Kanengo Industrial Area',
    area: 'Tobacco Auction Floors, M1 North, Lilongwe, Malawi',
    category: 'Factories & Freight Terminals',
    icon: 'factory',
    lat: -13.8820,
    lng: 33.7950,
    tags: ['kanengo', 'industrial', 'tobacco', 'auction floors', 'm1']
  },
  {
    name: 'Four Seasons Nursery & Garden',
    area: 'Presidential Way, Area 12, Lilongwe, Malawi',
    category: 'Dining & Botanical Centre',
    icon: 'park',
    lat: -13.9610,
    lng: 33.7930,
    tags: ['four seasons', 'area 12', 'garden', 'presidential way']
  },
  {
    name: 'Game Stores & Shoprite Mall',
    area: 'Kamuzu Procession Rd, Area 4, Lilongwe, Malawi',
    category: 'Hypermarket & Retail Center',
    icon: 'shopping_bag',
    lat: -13.9830,
    lng: 33.7720,
    tags: ['game', 'shoprite', 'mall', 'area 4']
  },
  {
    name: 'Kamuzu International Airport (LLW)',
    area: 'Lumbadzi, M1 North, Lilongwe, Malawi',
    category: 'International Airport Terminal',
    icon: 'flight_takeoff',
    lat: -13.7894,
    lng: 33.7810,
    tags: ['airport', 'llw', 'flight', 'kamuzu airport', 'lumbadzi']
  },
  {
    name: 'Area 10 (Residential & Diplomatic Quarter)',
    area: 'Presidential Way / Kenyatta Rd, Area 10, Lilongwe, Malawi',
    category: 'Diplomatic Enclave & Residences',
    icon: 'nature_people',
    lat: -13.9520,
    lng: 33.7950,
    tags: ['area 10', 'area10', 'diplomatic', 'kenyatta', 'embassies', 'sanctuary']
  },
  {
    name: 'Area 18 (Commercial Hub & Filling Station)',
    area: 'Kaunda Rd / M1 Bypass, Area 18A / 18B, Lilongwe, Malawi',
    category: 'Marketplace & Transit Hub',
    icon: 'local_gas_station',
    lat: -13.9350,
    lng: 33.7850,
    tags: ['area 18', 'area18', 'area 18a', 'area 18b', 'market', 'filling station', 'kaunda']
  },
  {
    name: 'Area 49 (Gulliver & Shire Urban Hub)',
    area: 'Kaunda Road / Shire St, Area 49, Lilongwe, Malawi',
    category: 'Residential & Stadium Commercial Corridor',
    icon: 'location_city',
    lat: -13.9400,
    lng: 33.7400,
    tags: ['area 49', 'area49', 'gulliver', 'shire', 'bingu', 'kaunda']
  },
  {
    name: 'Lumbadzi Trading Centre & Airport Junction',
    area: 'M1 North Highway, Lumbadzi, Lilongwe, Malawi',
    category: 'Northern Commercial Hub & LLW Junction',
    icon: 'traffic',
    lat: -13.7850,
    lng: 33.7800,
    tags: ['lumbadzi', 'airport', 'llw', 'm1 north', 'trading centre']
  },
  {
    name: 'Area 25 Shopping Centre',
    area: 'Sector C, Area 25, Lilongwe, Malawi',
    category: 'Community Marketplace',
    icon: 'store',
    lat: -13.8990,
    lng: 33.7650,
    tags: ['area 25', 'market']
  },
  {
    name: 'Area 47 Sector 3 (Green Pharmacy)',
    area: 'Kaunda Road, Area 47, Lilongwe, Malawi',
    category: 'Pharmacy & Residential Hub',
    icon: 'medication',
    lat: -13.9710,
    lng: 33.7630,
    tags: ['area 47', 'pharmacy', 'green pharmacy', 'kaunda']
  },
  {
    name: 'Lilongwe Wildlife Centre',
    area: 'Kenyatta Drive, Area 11, Lilongwe, Malawi',
    category: 'Wildlife Sanctuary & Eco Park',
    icon: 'pets',
    lat: -13.9680,
    lng: 33.7820,
    tags: ['wildlife', 'animals', 'area 11', 'kenyatta']
  },
  {
    name: 'Blantyre City Centre (Victoria Ave)',
    area: 'Victoria Avenue, Blantyre, Southern Region, Malawi',
    category: 'Intercity Commercial Hub',
    icon: 'domain',
    lat: -15.7861,
    lng: 35.0058,
    tags: ['blantyre', 'victoria', 'southern', 'chichiri']
  },
  {
    name: 'Mzuzu Clock Tower',
    area: 'M1 Highway, Mzuzu, Northern Region, Malawi',
    category: 'Northern Hub & Regional Market',
    icon: 'schedule',
    lat: -11.4583,
    lng: 34.0167,
    tags: ['mzuzu', 'clock tower', 'northern']
  },
  {
    name: 'Salima Lakeshore (Senga Bay)',
    area: 'Beach Road, Senga Bay, Salima, Lake Malawi',
    category: 'Lakeside Tourism & Lodges',
    icon: 'beach_access',
    lat: -13.7250,
    lng: 34.6150,
    tags: ['salima', 'senga bay', 'lake malawi']
  }
];

const DEFAULT_ORIGIN = { lat: -13.9722, lng: 33.7667 };

function formatLocationResult(loc, originLat, originLng) {
  const km = calculateDistanceKm(originLat, originLng, loc.lat, loc.lng);
  const fareBike = Math.max(1200, Math.round(1200 + km * 380));
  const fareAuto = Math.max(2200, Math.round(2200 + km * 550));
  const fareCab = Math.max(4500, Math.round(4500 + km * 900));
  const mins = Math.max(3, Math.round(km * 2.2));

  return {
    name: loc.name,
    area: loc.area,
    category: loc.category || 'Malawi Transit Location',
    icon: loc.icon || 'location_on',
    lat: loc.lat,
    lng: loc.lng,
    km: km,
    mins: mins,
    fare: fareBike,
    fares: {
      bike: fareBike,
      auto: fareAuto,
      cab: fareCab
    }
  };
}

// API: Real-Time Location Search for Malawi (Local Registry + Live OpenStreetMap)
app.get('/api/search-locations', async (req, res) => {
  const query = (req.query.q || '').trim();
  const originLat = parseFloat(req.query.lat) || DEFAULT_ORIGIN.lat;
  const originLng = parseFloat(req.query.lng) || DEFAULT_ORIGIN.lng;

  if (!query) {
    const popular = MALAWI_LOCATIONS.slice(0, 8).map(loc => formatLocationResult(loc, originLat, originLng));
    return res.json(popular);
  }

  const qLower = query.toLowerCase();

  // 1. Check Local Registry (prioritizes EPTL Malawi, Area 4, etc.)
  const localMatches = MALAWI_LOCATIONS.filter(loc => {
    return loc.name.toLowerCase().includes(qLower) ||
           loc.area.toLowerCase().includes(qLower) ||
           (loc.tags && loc.tags.some(tag => tag.toLowerCase().includes(qLower)));
  }).map(loc => formatLocationResult(loc, originLat, originLng));

  // 2. Query Live OpenStreetMap (Photon) for Malawi
  let remoteMatches = [];
  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${originLat}&lon=${originLng}&limit=8`;
    const response = await fetch(photonUrl, {
      headers: { 'User-Agent': 'AArohanMobility/1.0' },
      signal: AbortSignal.timeout(1800)
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.features) {
        remoteMatches = data.features
          .filter(f => f.properties && (
            f.properties.countrycode === 'MW' || 
            f.properties.country === 'Malawi' || 
            f.properties.state === 'Lilongwe' ||
            (f.geometry && f.geometry.coordinates && f.geometry.coordinates[0] > 32.5 && f.geometry.coordinates[0] < 36.0 && f.geometry.coordinates[1] > -17.5 && f.geometry.coordinates[1] < -9.0)
          ))
          .map(f => {
            const p = f.properties;
            const coords = f.geometry.coordinates; // [lng, lat]
            const title = p.name || p.street || 'Malawi Transit Point';
            const subtitle = [p.street, p.city || p.district || p.state || 'Lilongwe', 'Malawi'].filter(Boolean).join(', ');
            return formatLocationResult({
              name: title,
              area: subtitle,
              category: p.type || p.osm_value || 'Malawi Place',
              icon: 'location_on',
              lat: coords[1],
              lng: coords[0]
            }, originLat, originLng);
          });
      }
    }
  } catch (err) {
    // Network timeout or offline; localMatches will be returned seamlessly
  }

  // Combine and deduplicate by coordinate proximity
  const combined = [...localMatches];
  for (const rem of remoteMatches) {
    const isDuplicate = combined.some(c => 
      c.name.toLowerCase() === rem.name.toLowerCase() ||
      (Math.abs(c.lat - rem.lat) < 0.003 && Math.abs(c.lng - rem.lng) < 0.003)
    );
    if (!isDuplicate) {
      combined.push(rem);
    }
  }

  res.json(combined.slice(0, 10));
});

// API: Reset dev state
app.post('/api/reset', (req, res) => {
  res.json({ message: 'State reset successfully' });
});

// Socket.IO Real-Time Connection
// TEMPORARY DEV AUTH - STEP 2 ONLY (Socket.IO Handshake Authentication)
io.use(async (socket, next) => {
  try {
    const handshakeUserId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    const handshakeRole = socket.handshake.auth?.role || socket.handshake.query?.role || 'RIDER';

    let socketUser = null;
    if (handshakeUserId) {
      socketUser = await prisma.user.findUnique({
        where: { id: handshakeUserId },
        include: { wallet: true, driverProfile: { include: { vehicle: true } } }
      });
    }
    if (!socketUser) {
      const phone = handshakeRole === 'DRIVER' ? '+265995541122' : '+265991234567';
      socketUser = await prisma.user.findUnique({
        where: { phone },
        include: { wallet: true, driverProfile: { include: { vehicle: true } } }
      });
    }

    socket.userId = socketUser ? socketUser.id : 'USR-DEV-DEFAULT';
    socket.userRole = socketUser ? socketUser.role : handshakeRole;
    socket.driverId = socketUser?.driverProfile ? socketUser.driverProfile.id : null;
    next();
  } catch (err) {
    next();
  }
});

let connectedClients = 0;

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`[Socket.IO] Client connected (${socket.id}, User: ${socket.userId}, Role: ${socket.userRole}). Total clients: ${connectedClients}`);
  io.emit('clients:count', connectedClients);

  // 1. Trip Request from Rider App (on Phone or Web)
  socket.on('trip:request', async (data, callback) => {
    console.log('[RealTime] Rider requested trip:', data);
    try {
      const fare = Math.round(data.fare || 1500);
      const baseFare = Math.round(data.baseFare || fare);
      const commission = Math.round(fare * 0.30);
      const driverShare = fare - commission;
      const pin = Math.floor(1000 + Math.random() * 9000).toString();

      const trip = await prisma.$transaction(async (tx) => {
        const created = await tx.trip.create({
          data: {
            riderId: socket.userId,
            status: 'REQUESTED',
            tier: (data.tierId || 'moto').toUpperCase(),
            pickupAddress: (typeof data.pickup === 'string') ? data.pickup : (data.pickup?.name || data.pickup?.address || 'Pickup Point'),
            dropoffAddress: (typeof data.destination === 'string') ? data.destination : (data.destination?.name || data.destination?.address || 'Destination'),
            pickupLat: parseFloat(data.pickup?.lat) || -13.9722,
            pickupLng: parseFloat(data.pickup?.lng) || 33.7667,
            dropoffLat: parseFloat(data.destination?.lat) || -13.9933,
            dropoffLng: parseFloat(data.destination?.lng) || 33.6777,
            distanceKm: parseFloat(data.distanceKm) || 3.5,
            durationMins: parseInt(data.durationMins, 10) || 8,
            fareMWK: fare,
            baseFareMWK: baseFare,
            bookingFeeMWK: 150,
            driverShareMWK: driverShare,
            commissionMWK: commission,
            pin: pin,
            idempotencyKey: data.idempotencyKey || `REQ-${socket.userId}-${Date.now()}`,
            paymentMethod: (data.paymentMethod && data.paymentMethod.toUpperCase().includes('CASH')) ? 'CASH' : 'WALLET_ESCROW'
          },
          include: {
            rider: { select: { id: true, name: true, phone: true } }
          }
        });

        await tx.tripStatusHistory.create({
          data: {
            tripId: created.id,
            fromStatus: null,
            status: 'REQUESTED',
            changedBy: socket.userId,
            reason: 'Rider initiated booking'
          }
        });

        return created;
      }, { maxWait: 10000, timeout: 30000 });

      socket.join(`trip:${trip.id}`);
      io.emit('trip:requested', trip);
      if (typeof callback === 'function') callback({ success: true, trip });
    } catch (err) {
      console.warn('[TripRequest] Error creating trip:', err.message);
      const isDuplicateActive = err.code === 'P2002' || err.message.includes('unique_active_trip_per_rider');
      const errorMsg = isDuplicateActive
        ? 'Rider already has an active trip'
        : (err.message || 'Failed to request trip');
      socket.emit('trip:error', { error: errorMsg, code: err.code });
      if (typeof callback === 'function') callback({ success: false, error: errorMsg });
    }
  });

  // 2. Driver Accepts Trip
  socket.on('trip:accept', async (data = {}, callback) => {
    console.log('[RealTime] Driver accepted trip request:', data);
    try {
      const resolvedDriverId = socket.driverId || data.driverId || 'DRV-MW-101';
      const tripId = data.tripId;
      if (!tripId) {
        throw new Error('tripId is required to accept a trip');
      }

      const updatedTrip = await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUnique({
          where: { id: tripId },
          include: { driver: true }
        });

        if (!trip) throw new Error('Trip not found');
        if (trip.status !== 'REQUESTED' && trip.status !== 'OFFERED') {
          throw new Error('Trip is no longer available');
        }
        if (trip.driverId) {
          throw new Error('Trip already accepted by another driver');
        }

        let driverRecord = await tx.driver.findFirst({
          where: { OR: [{ id: resolvedDriverId }, { userId: socket.userId }] }
        });
        if (!driverRecord) {
          driverRecord = await tx.driver.findFirst({ where: { approvalStatus: 'APPROVED' } });
        }

        // Atomic conditional update: strictly 1 driver can transition this trip
        const updateResult = await tx.trip.updateMany({
          where: {
            id: tripId,
            status: { in: ['REQUESTED', 'OFFERED'] },
            driverId: null
          },
          data: {
            driverId: driverRecord ? driverRecord.id : null,
            status: 'DRIVER_ARRIVING',
            acceptedAt: new Date()
          }
        });

        if (updateResult.count === 0) {
          throw new Error('Trip already accepted by another driver');
        }

        const accepted = await tx.trip.findUnique({
          where: { id: tripId },
          include: {
            rider: { select: { id: true, name: true, phone: true } },
            driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } }
          }
        });

        await tx.tripStatusHistory.create({
          data: {
            tripId: accepted.id,
            fromStatus: trip ? trip.status : 'REQUESTED',
            status: 'DRIVER_ARRIVING',
            changedBy: socket.userId,
            reason: 'Driver accepted ride offer'
          }
        });

        return accepted;
      }, { maxWait: 10000, timeout: 30000 });

      socket.join(`trip:${updatedTrip.id}`);
      io.to(`trip:${updatedTrip.id}`).emit('trip:accepted', { trip: updatedTrip, driver: updatedTrip.driver });
      io.emit('trip:accepted', { trip: updatedTrip, driver: updatedTrip.driver });
      if (typeof callback === 'function') callback({ success: true, trip: updatedTrip });
    } catch (err) {
      console.warn('[TripAccept] Error:', err.message);
      const isDuplicateDriver = err.code === 'P2002' || err.message.includes('already accepted');
      const errorMsg = isDuplicateDriver
        ? 'Trip already accepted by another driver'
        : (err.message || 'Failed to accept trip');
      socket.emit('trip:error', { error: errorMsg, code: err.code });
      if (typeof callback === 'function') callback({ success: false, error: errorMsg });
    }
  });

  // 3. Driver Live GPS Telemetry
  socket.on('trip:driver_moved', async (coords) => {
    if (coords && coords.lat && coords.lng) {
      if (socket.driverId) {
        try {
          await prisma.driver.update({
            where: { id: socket.driverId },
            data: { currentLat: parseFloat(coords.lat), currentLng: parseFloat(coords.lng), lastLocationAt: new Date() }
          });
        } catch (e) { }
      }
      socket.broadcast.emit('trip:driver_moved', coords);
    }
  });

  // 4. Driver Arrived at Pickup
  socket.on('trip:arrived', async (data = {}, callback) => {
    console.log('[RealTime] Driver arrived at pickup location:', data);
    try {
      const tripId = data.tripId;
      const trip = await prisma.trip.findFirst({
        where: tripId ? { id: tripId } : { driverId: socket.driverId, status: 'DRIVER_ARRIVING' },
        include: { driver: true }
      });

      if (!trip) throw new Error('Active arriving trip not found');
      if (socket.driverId && trip.driverId !== socket.driverId && trip.driver?.userId !== socket.userId) {
        throw new Error('Unauthorized: Driver does not own this trip');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const t = await tx.trip.update({
          where: { id: trip.id },
          data: { status: 'ARRIVED', arrivedAt: new Date() },
          include: { rider: true, driver: { include: { user: true, vehicle: true } } }
        });
        await tx.tripStatusHistory.create({
          data: {
            tripId: t.id,
            fromStatus: trip.status,
            status: 'ARRIVED',
            changedBy: socket.userId,
            reason: 'Driver arrived at pickup location'
          }
        });
        return t;
      }, { maxWait: 10000, timeout: 30000 });

      io.to(`trip:${updated.id}`).emit('trip:arrived', updated);
      io.emit('trip:arrived', updated);
      if (typeof callback === 'function') callback({ success: true, trip: updated });
    } catch (err) {
      socket.emit('trip:error', { error: err.message });
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 5. Trip In Transit
  socket.on('trip:start_transit', async (data = {}, callback) => {
    console.log('[RealTime] Trip in transit requested:', data);
    try {
      const tripId = data.tripId;
      const trip = await prisma.trip.findFirst({
        where: tripId ? { id: tripId } : { driverId: socket.driverId, status: 'ARRIVED' },
        include: { driver: true }
      });

      if (!trip) throw new Error('Arrived trip not found');
      if (socket.driverId && trip.driverId !== socket.driverId && trip.driver?.userId !== socket.userId) {
        throw new Error('Unauthorized: Driver does not own this trip');
      }

      // Check if locked after 5 previous wrong attempts
      if (trip.pinAttempts >= 5) {
        throw new Error('PIN entry locked: Maximum attempts (5) exceeded');
      }

      if (!data.pin || data.pin !== trip.pin) {
        await prisma.trip.update({
          where: { id: trip.id },
          data: { pinAttempts: { increment: 1 } }
        });
        throw new Error('Invalid passenger safety PIN');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const t = await tx.trip.update({
          where: { id: trip.id },
          data: { status: 'IN_TRANSIT', startedAt: new Date() },
          include: { rider: true, driver: { include: { user: true, vehicle: true } } }
        });
        await tx.tripStatusHistory.create({
          data: {
            tripId: t.id,
            fromStatus: trip.status,
            status: 'IN_TRANSIT',
            changedBy: socket.userId,
            reason: 'Passenger PIN verified, transit started'
          }
        });
        return t;
      }, { maxWait: 10000, timeout: 30000 });

      io.to(`trip:${updated.id}`).emit('trip:in_transit', updated);
      io.emit('trip:in_transit', updated);
      if (typeof callback === 'function') callback({ success: true, trip: updated });
    } catch (err) {
      socket.emit('trip:error', { error: err.message });
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 6. Trip Completed - Atomic Double-Entry Financial Settlement
  socket.on('trip:complete', async (completionData = {}, callback) => {
    console.log('[RealTime] Trip complete event:', completionData);
    try {
      const tripId = completionData.tripId;
      const trip = await prisma.trip.findFirst({
        where: tripId ? { id: tripId } : { driverId: socket.driverId, status: 'IN_TRANSIT' },
        include: { driver: true, rider: true }
      });

      if (!trip) throw new Error('In-transit trip not found');
      if (socket.driverId && trip.driverId !== socket.driverId && trip.driver?.userId !== socket.userId) {
        throw new Error('Unauthorized: Driver does not own this trip');
      }

      const paymentMethod = completionData.paymentMethod || trip.paymentMethod || 'CASH';
      const driverTip = completionData.driverTip || trip.driverTipMWK || 0;

      const settleResult = await dbLedger.settleRide({
        tripId: trip.id,
        paymentMethod,
        driverTipMWK: driverTip,
        changedBy: socket.userId
      });

      io.to(`trip:${trip.id}`).emit('trip:completed', {
        trip: settleResult.trip,
        journalId: settleResult.journalId,
        netBalanceSum: settleResult.netBalanceSum,
        breakdown: settleResult.breakdown
      });
      io.emit('trip:completed', {
        trip: settleResult.trip,
        journalId: settleResult.journalId,
        netBalanceSum: settleResult.netBalanceSum,
        breakdown: settleResult.breakdown
      });
      if (typeof callback === 'function') {
        callback({
          success: true,
          trip: settleResult.trip,
          journalId: settleResult.journalId,
          breakdown: settleResult.breakdown
        });
      }
    } catch (err) {
      socket.emit('trip:error', { error: err.message });
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 7. Rider Rating & Driver Tip
  socket.on('trip:rate', async (review = {}) => {
    console.log('[RealTime] Rider rating submitted:', review);
    try {
      const tripId = review.tripId;
      const trip = await prisma.trip.findFirst({
        where: tripId ? { id: tripId } : { riderId: socket.userId, status: 'COMPLETED' },
        include: { driver: true }
      });

      if (trip && trip.driver?.userId) {
        await prisma.$transaction(async (tx) => {
          await tx.rating.upsert({
            where: {
              tripId_fromUserId: { tripId: trip.id, fromUserId: socket.userId }
            },
            create: {
              tripId: trip.id,
              fromUserId: socket.userId,
              toUserId: trip.driver.userId,
              stars: Math.min(5, Math.max(1, parseInt(review.rating, 10) || 5)),
              tags: Array.isArray(review.tags) ? review.tags : [],
              comment: review.comment || null
            },
            update: {
              stars: Math.min(5, Math.max(1, parseInt(review.rating, 10) || 5)),
              comment: review.comment || null
            }
          });
        });
      }
      io.emit('trip:rated', { review, tripId: trip?.id });
    } catch (err) {
      console.warn('[TripRate] Error:', err.message);
    }
  });

  // 8. Trip Cancelled
  socket.on('trip:cancel', async (data = {}) => {
    console.log('[RealTime] Trip cancel requested:', data);
    try {
      const tripId = typeof data === 'string' ? data : data.tripId;
      const reason = (typeof data === 'object' && data.reason) ? data.reason : 'Cancelled by user';

      const trip = await prisma.trip.findFirst({
        where: tripId ? { id: tripId } : {
          OR: [{ riderId: socket.userId }, { driverId: socket.driverId }],
          status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED'] }
        }
      });

      if (trip) {
        const isRider = trip.riderId === socket.userId;
        const newStatus = isRider ? 'CANCELLED_BY_RIDER' : 'CANCELLED_BY_DRIVER';

        const updated = await prisma.$transaction(async (tx) => {
          const t = await tx.trip.update({
            where: { id: trip.id },
            data: {
              status: newStatus,
              cancelledBy: isRider ? 'RIDER' : 'DRIVER',
              cancelReason: reason,
              cancelledAt: new Date()
            }
          });
          await tx.tripStatusHistory.create({
            data: {
              tripId: t.id,
              fromStatus: trip.status,
              status: newStatus,
              changedBy: socket.userId,
              reason
            }
          });
          return t;
        });

        io.to(`trip:${updated.id}`).emit('trip:cancelled', { tripId: updated.id, status: newStatus, reason });
        io.emit('trip:cancelled', { tripId: updated.id, status: newStatus, reason });
      }
    } catch (err) {
      console.warn('[TripCancel] Error:', err.message);
    }
  });

  // 9. Real-Time Chat (Rider <-> Driver)
  socket.on('chat:send', async (msg = {}) => {
    console.log('[RealTime Chat]', msg.sender, ':', msg.text);
    try {
      if (msg.tripId) {
        await prisma.chatMessage.create({
          data: {
            tripId: msg.tripId,
            senderId: socket.userId,
            senderRole: socket.userRole || (msg.sender === 'driver' ? 'DRIVER' : 'RIDER'),
            text: msg.text || ''
          }
        });
      }
      const messageObj = {
        tripId: msg.tripId,
        sender: msg.sender,
        text: msg.text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      if (msg.tripId) io.to(`trip:${msg.tripId}`).emit('chat:message', messageObj);
      io.emit('chat:message', messageObj);
    } catch (err) {
      console.warn('[Chat] Error:', err.message);
    }
  });

  // 10. SOS Emergency Alert Trigger
  socket.on('sos:trigger', async (data = {}) => {
    console.warn('[RealTime SOS Alert!]', data);
    try {
      let validTripId = null;
      if (data.tripId) {
        const tripExists = await prisma.trip.findUnique({ where: { id: data.tripId } });
        if (tripExists) validTripId = data.tripId;
      }

      let validUserId = socket.userId;
      if (!validUserId || validUserId === 'USR-DEV-DEFAULT') {
        const fallbackUser = await prisma.user.findFirst({ where: { role: 'RIDER' } });
        if (fallbackUser) validUserId = fallbackUser.id;
      }

      const sosEvent = await prisma.sosEvent.create({
        data: {
          tripId: validTripId,
          userId: validUserId,
          lat: parseFloat(data.lat) || -13.9722,
          lng: parseFloat(data.lng) || 33.7667,
          notes: data.note || 'Emergency assistance requested on corridor',
          status: 'ACTIVE'
        }
      });

      const alertItem = {
        id: sosEvent.id,
        source: data.source || 'RIDER',
        location: data.location || 'Kenyatta Drive, Lilongwe',
        lat: sosEvent.lat,
        lng: sosEvent.lng,
        riderPhone: data.riderPhone || '+265991234567',
        emergencyPhone: data.emergencyPhone || '+265999970000',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'ACTIVE_DISPATCH_ALERT',
        note: data.note || 'Emergency assistance requested on corridor'
      };

      io.emit('sos:alert', alertItem);
      notificationService.sendEmergencySosAlert(alertItem).catch(err => {
        console.warn('[NotificationService] SOS broadcast exception:', err.message);
      });
    } catch (err) {
      console.error('[SosTrigger] Error:', err.message);
    }
  });

  // 11. SOS Resolution (from Admin desk)
  socket.on('sos:resolve', async (id) => {
    try {
      await prisma.sosEvent.update({
        where: { id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: socket.userId }
      });
      io.emit('sos:resolved', id);
    } catch (err) {
      console.warn('[SosResolve] Error:', err.message);
    }
  });

  // 12. Dynamic Surge Multiplier Update (Admin)
  socket.on('surge:update', (data) => {
    if (data && data.zone) {
      operationalState.surgeMultipliers[data.zone] = parseFloat(data.multiplier);
      io.emit('surge:updated', data);
    }
  });

  // 13. Rider Wallet Top Up (Airtel Money / TNM Mpamba)
  socket.on('wallet:topup', async (data = {}) => {
    try {
      const amt = parseInt(data.amount, 10) || 10000;
      const provider = data.provider || 'Airtel Money';
      const result = await dbLedger.recordWalletTopup({
        userId: socket.userId,
        amountMWK: amt,
        provider,
        idempotencyKey: data.idempotencyKey
      });
      socket.emit('wallet:updated', { wallet: result.wallet, netBalanceSum: result.netBalanceSum });
      io.emit('wallet:updated', { userId: socket.userId, wallet: result.wallet });
    } catch (err) {
      socket.emit('wallet:error', { error: err.message });
    }
  });

  // 14. P2P Kwacha Transfer
  socket.on('wallet:transfer', async (data = {}) => {
    try {
      const amt = parseInt(data.amount, 10) || 0;
      let recipientUserId = data.recipientId;
      if (!recipientUserId && data.phone) {
        const recipient = await prisma.user.findUnique({ where: { phone: data.phone } });
        if (recipient) recipientUserId = recipient.id;
      }
      if (!recipientUserId) throw new Error('Recipient not found');

      const result = await dbLedger.recordP2PTransfer({
        senderUserId: socket.userId,
        recipientUserId,
        amountMWK: amt,
        idempotencyKey: data.idempotencyKey
      });
      socket.emit('wallet:updated', { wallet: result.senderWallet, netBalanceSum: result.netBalanceSum });
    } catch (err) {
      socket.emit('wallet:error', { error: err.message });
    }
  });

  // 15. In-App Call Signaling
  socket.on('call:signal', (signal) => {
    socket.broadcast.emit('call:signal', signal);
  });

  socket.on('disconnect', () => {
    connectedClients--;
    console.log(`[Socket.IO] Client disconnected (${socket.id}). Remaining: ${connectedClients}`);
    io.emit('clients:count', connectedClients);
  });
});

module.exports = { server, app, io, expireStaleTrips };

// Start Server
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const localUrl = `http://localhost:${PORT}`;
    const networkRiderUrl = `http://${LOCAL_IP}:${PORT}/rider/`;

    console.log('\n=============================================================');
    console.log('   AAROHAN • REAL-TIME RIDE-HAILING PLATFORM • LILONGWE');
    console.log('=============================================================');
    console.log(` > Server running locally on:   ${localUrl}`);
    console.log(` > Phone Rider App URL:         ${networkRiderUrl}`);
    console.log(` > Driver App URL:              http://${LOCAL_IP}:${PORT}/driver/`);
    console.log(` > Operations Admin Portal:     http://${LOCAL_IP}:${PORT}/admin/`);
    console.log('-------------------------------------------------------------');
    console.log(' Scan this QR code with your phone camera to open the Rider App:');
    console.log('-------------------------------------------------------------');

    try {
      qrcodeTerminal.generate(networkRiderUrl, { small: true });
    } catch (e) {
      console.log('Open in phone browser: ' + networkRiderUrl);
    }

    console.log('=============================================================\n');
  });
}
