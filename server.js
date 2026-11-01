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
const STORE_FILE = path.join(DATA_DIR, 'store.json');

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

// Default initial state
const defaultState = {
  rider: {
    name: 'Chisomo Banda',
    phone: '+265 99 123 4567',
    walletBalance: 38500,
    rating: 4.90,
    tripsCompleted: 24,
    kycTier: 'KYC Tier 1 (Verified)'
  },
  driver: {
    name: 'Chikondi Phiri',
    phone: '+265 99 554 1122',
    plate: 'BW 4920',
    car: 'White Toyota Passo',
    rating: 4.92,
    tripsCompleted: 1420,
    availableBalance: 142800,
    todayEarnings: 42500,
    todayTrips: 8,
    status: 'ONLINE',
    location: { lat: -13.9650, lng: 33.7820, heading: 45 }
  },
  activeTrip: {
    id: 'TRIP-LL-9821',
    status: 'IDLE', // IDLE, REQUESTED, ACCEPTED, EN_ROUTE, ARRIVED, IN_TRANSIT, COMPLETED
    pickup: 'Area 47 Sector 3, Kaunda Road',
    destination: 'Gateway Mall, Kaunda Rd',
    tier: 'Mwendo City',
    baseFare: 6200,
    finalFare: 6200,
    paymentMethod: 'Airtel Money',
    pin: '8421',
    driverLocation: { lat: -13.9650, lng: 33.7820 },
    distanceKm: 6.8,
    etaMins: 3,
    requestedAt: null,
    acceptedAt: null,
    completedAt: null
  },
  chatMessages: [
    { sender: 'driver', text: 'Moni Chisomo! I am on Kenyatta Drive approaching Area 47 Sector 3.', time: '14:21' }
  ],
  surgeMultipliers: {
    'Gateway Mall': 1.4,
    'Area 3 Commercial': 1.3,
    'Old Town Market': 1.2,
    'Area 47 Sector 3': 1.0,
    'Bingu Stadium': 1.1
  },
  emergencyAlerts: [],
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
  ],
  transactionLogs: [
    { id: 'TX-101', type: 'TRIP', title: 'Trip to Gateway Mall', amount: -6200, method: 'Airtel Money', time: 'Today 14:30', status: 'Completed' },
    { id: 'TX-102', type: 'TOPUP', title: 'Top Up from TNM Mpamba', amount: 20000, method: 'TNM Mpamba', time: 'Yesterday 09:15', status: 'Success' },
    { id: 'TX-103', type: 'TRIP', title: 'Kabaza: Old Town Market', amount: -2500, method: 'Mwendo Cash', time: '2 days ago', status: 'Completed' }
  ],
  driverSettlements: [
    { id: 'DS-201', title: 'Gateway Mall to Area 47', amount: 5270, method: 'Airtel Money credit', time: 'Today 14:42', status: 'Instant Settled' },
    { id: 'DS-202', title: 'City Center to Old Town', amount: 3400, method: 'Cash trip recorded', time: 'Today 12:15', status: 'Cash In Pocket' }
  ]
};

// Load or initialize state
let state = defaultState;
if (fs.existsSync(STORE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (state && state.activeTrip) {
      if (state.activeTrip.destination && typeof state.activeTrip.destination !== 'string') {
        state.activeTrip.destination = state.activeTrip.destination.name || state.activeTrip.destination.address || 'Destination';
      }
      if (state.activeTrip.pickup && typeof state.activeTrip.pickup !== 'string') {
        state.activeTrip.pickup = state.activeTrip.pickup.name || state.activeTrip.pickup.address || 'Pickup Point';
      }
    }
  } catch (err) {
    console.warn('Could not read existing store file, using defaults.', err);
  }
}

function persistState() {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}

// Ensure map configuration state exists
if (!state.mapConfig) {
  state.mapConfig = {
    provider: process.env.MAP_PROVIDER || 'carto',
    apiKey: process.env.MAP_API_KEY || process.env.MAPBOX_ACCESS_TOKEN || '',
    mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || '',
    maptilerKey: process.env.MAPTILER_API_KEY || ''
  };
} else {
  if (process.env.MAPBOX_ACCESS_TOKEN && !state.mapConfig.mapboxToken) {
    state.mapConfig.mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
  }
  if (process.env.MAPTILER_API_KEY && !state.mapConfig.maptilerKey) {
    state.mapConfig.maptilerKey = process.env.MAPTILER_API_KEY;
  }
  if (process.env.MAP_API_KEY && !state.mapConfig.apiKey) {
    state.mapConfig.apiKey = process.env.MAP_API_KEY;
  }
  if (process.env.MAP_PROVIDER && state.mapConfig.provider === 'carto') {
    state.mapConfig.provider = process.env.MAP_PROVIDER;
  }
}

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

// API: Get current state
app.get('/api/state', (req, res) => {
  res.json(state);
});

// API: Get Map Configuration & Public Keys
app.get('/api/map-config', (req, res) => {
  const cfg = state.mapConfig || {
    provider: process.env.MAP_PROVIDER || 'carto',
    apiKey: process.env.MAP_API_KEY || '',
    mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || '',
    maptilerKey: process.env.MAPTILER_API_KEY || ''
  };
  res.json({
    ...cfg,
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
app.post('/api/drivers/location', (req, res) => {
  const { driverId, lat, lng, heading, accuracy, speed } = req.body;
  if (!driverId || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'driverId, lat and lng required' });
  }

  const updatedDriver = dispatchService.updateDriverLocation(driverId, { lat, lng, heading, accuracy, speed });
  if (updatedDriver) {
    state.driver = updatedDriver;
    if (state.activeTrip && state.activeTrip.status !== 'IDLE' && state.activeTrip.status !== 'COMPLETED') {
      state.activeTrip.driverLocation = updatedDriver.location;
      io.emit('trip:driver_moved', updatedDriver.location);
    }
    res.json({ success: true, driver: updatedDriver });
  } else {
    res.status(404).json({ error: 'Driver not found' });
  }
});

// 6. User Saved Places (Phase 8: Home, Work, Custom)
app.get('/api/user/saved-places', (req, res) => {
  if (!state.savedPlaces) state.savedPlaces = [];
  res.json(state.savedPlaces);
});

app.post('/api/user/saved-places', (req, res) => {
  const { label, name, address, lat, lng } = req.body;
  if (!name || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'name, lat, and lng are required' });
  }
  if (!state.savedPlaces) state.savedPlaces = [];

  const newPlace = {
    id: 'PLC-' + Date.now().toString(36),
    label: label || 'Custom',
    name,
    address: address || name,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    createdAt: Date.now()
  };

  // Replace if same label exists (e.g. Home or Work)
  if (label && ['Home', 'Work'].includes(label)) {
    state.savedPlaces = state.savedPlaces.filter(p => p.label !== label);
  }
  state.savedPlaces.push(newPlace);
  persistState();
  res.json({ success: true, savedPlace: newPlace, savedPlaces: state.savedPlaces });
});

app.delete('/api/user/saved-places/:id', (req, res) => {
  if (!state.savedPlaces) state.savedPlaces = [];
  state.savedPlaces = state.savedPlaces.filter(p => p.id !== req.params.id);
  persistState();
  res.json({ success: true, savedPlaces: state.savedPlaces });
});

// 7. Frequent Destinations (Phase 8: dynamically calculated from real completed trips)
app.get('/api/user/frequent-places', (req, res) => {
  const logs = (state.transactionLogs || []).filter(tx => tx.type === 'TRIP');
  const counts = new Map();

  logs.forEach(tx => {
    const dest = (tx.title || '').replace(/^Trip to /i, '').trim();
    if (dest) {
      counts.set(dest, (counts.get(dest) || 0) + 1);
    }
  });

  const frequent = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json(frequent);
});

// 8. Admin Real-Time Metrics & Management (AArohan 30% Platform Commission Policy)
app.get('/api/admin/metrics', (req, res) => {
  const finReport = financeService.getPlatformFinancialReport();
  const completedTrips = (state.transactionLogs || []).filter(t => t.type === 'TRIP');
  const fallbackVolume = completedTrips.reduce((acc, t) => acc + Math.abs(t.amount || 0), 0);
  const totalVolumeMWK = finReport.totalGMV > 0 ? finReport.totalGMV : fallbackVolume;
  // 30% Commission Policy
  const platformRevenueMWK = finReport.netPlatformRevenue > 0 ? finReport.netPlatformRevenue : Math.round(totalVolumeMWK * 0.30);

  res.json({
    activeTripsCount: state.activeTrip && state.activeTrip.status !== 'IDLE' && state.activeTrip.status !== 'COMPLETED' ? 1 : 0,
    onlineDriversCount: Array.from(dispatchService.drivers.values()).filter(d => d.status === 'ONLINE').length,
    completedTripsCount: finReport.totalRidesCount || state.rider?.tripsCompleted || completedTrips.length,
    totalVolumeMWK,
    platformRevenueMWK,
    commissionRate: 0.30,
    driverShareRate: 0.70,
    cashGrossVolume: finReport.cashGrossVolume,
    digitalGrossVolume: finReport.digitalGrossVolume,
    outstandingCashCommission: finReport.outstandingCashCommission,
    completedPayoutsTotal: finReport.completedPayoutsTotal,
    connectedClients,
    emergencyAlertsCount: (state.emergencyAlerts || []).length
  });
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
app.post('/api/rides/complete', (req, res) => {
  try {
    const { rideId, driverTip, paymentMethod } = req.body;
    if (!rideId) return res.status(400).json({ error: 'rideId is required' });

    const completion = dispatchService.completeTrip(rideId, { driverTip, paymentMethod });
    
    // Sync state for connected clients
    if (state.activeTrip && state.activeTrip.id === rideId) {
      state.activeTrip.status = 'COMPLETED';
      state.activeTrip.completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    io.emit('trip:completed', completion);
    res.json({ success: true, ...completion });
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

// API: Reset state to default
app.post('/api/reset', (req, res) => {
  const currentMapConfig = state.mapConfig;
  state = JSON.parse(JSON.stringify(defaultState));
  if (currentMapConfig) state.mapConfig = currentMapConfig;
  persistState();
  io.emit('state:sync', state);
  res.json({ message: 'State reset successfully', state });
});

// Socket.IO Real-Time Connection
let connectedClients = 0;

io.on('connection', (socket) => {
  connectedClients++;
  console.log(`[Socket.IO] Client connected (${socket.id}). Total clients: ${connectedClients}`);

  // Send initial full state immediately
  socket.emit('state:sync', state);
  io.emit('clients:count', connectedClients);

  // 1. Trip Request from Rider App (on Phone or Web)
  socket.on('trip:request', (data) => {
    console.log('[RealTime] Rider requested trip:', data);
    let trip = null;

    if (data.quoteId) {
      try {
        trip = dispatchService.createTripBooking({
          quoteId: data.quoteId,
          tierId: data.tierId || 'moto',
          riderId: data.riderId || 'USR-RIDER-1',
          riderName: state.rider?.name || 'AArohan Passenger',
          riderPhone: state.rider?.phone || '+265 99 123 4567',
          paymentMethod: data.paymentMethod || 'Airtel Money Locked Escrow'
        });
      } catch (err) {
        console.warn('[TripRequest] Quote validation failed, falling back:', err.message);
      }
    }

    if (!trip) {
      const tripId = 'TRIP-AAR-' + Math.floor(1000 + Math.random() * 9000);
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      trip = {
        id: tripId,
        status: 'REQUESTED',
        pickup: (typeof data.pickup === 'string') ? data.pickup : (data.pickup?.name || data.pickup?.address || state.activeTrip.pickup || 'Pickup Point'),
        destination: (typeof data.destination === 'string') ? data.destination : (data.destination?.name || data.destination?.address || state.activeTrip.destination || 'Destination'),
        tier: data.tier || 'AArohan Moto',
        tierId: data.tierId || 'moto',
        baseFare: data.fare || 1500,
        finalFare: data.fare || 1500,
        paymentMethod: data.paymentMethod || 'Airtel Money Locked Escrow',
        pin: pin,
        distanceKm: data.distanceKm || 3.5,
        durationMins: data.durationMins || 8,
        etaMins: 3,
        driverLocation: state.driver.location,
        requestedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        acceptedAt: null,
        completedAt: null
      };
      dispatchService.trips.set(tripId, trip);
    }

    state.activeTrip = trip;
    persistState();
    io.emit('trip:requested', state.activeTrip);
    io.emit('state:sync', state);
  });

  // 2. Driver Accepts Trip
  socket.on('trip:accept', (data) => {
    console.log('[RealTime] Driver accepted trip');
    const driverId = (data && data.driverId) || 'DRV-MW-101';
    try {
      const res = dispatchService.acceptTrip(state.activeTrip.id, driverId);
      state.activeTrip = res.trip;
      state.driver = res.driver;
    } catch (e) {
      state.activeTrip.status = 'ACCEPTED';
      state.activeTrip.acceptedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    persistState();
    io.emit('trip:accepted', {
      trip: state.activeTrip,
      driver: state.driver
    });
    io.emit('state:sync', state);
  });

  // 3. Driver Live GPS Telemetry
  socket.on('trip:driver_moved', (coords) => {
    if (coords && coords.lat && coords.lng) {
      dispatchService.updateDriverLocation('DRV-MW-101', coords);
      state.driver.location = coords;
      if (state.activeTrip) state.activeTrip.driverLocation = coords;
      socket.broadcast.emit('trip:driver_moved', coords);
    }
  });

  // 4. Driver Arrived at Pickup
  socket.on('trip:arrived', () => {
    console.log('[RealTime] Driver arrived at pickup location');
    state.activeTrip.status = 'ARRIVED';
    persistState();
    io.emit('trip:arrived', state.activeTrip);
    io.emit('state:sync', state);
  });

  // 5. Trip In Transit
  socket.on('trip:start_transit', () => {
    console.log('[RealTime] Trip in transit');
    state.activeTrip.status = 'IN_TRANSIT';
    persistState();
    io.emit('trip:in_transit', state.activeTrip);
    io.emit('state:sync', state);
  });

  // 6. Trip Completed (Driver Slide-to-Complete) - Authoritative 30% Commission / 70% Driver Split
  socket.on('trip:complete', (completionData = {}) => {
    console.log('[RealTime] Trip completed! Settling financial escrow (30% AArohan / 70% Driver).');
    state.activeTrip.status = 'COMPLETED';
    state.activeTrip.completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const fare = state.activeTrip.finalFare || 6200;
    const paymentMethod = completionData.paymentMethod || state.activeTrip.paymentMethod || 'CASH';
    const driverTip = completionData.driverTip || state.activeTrip.tipAmount || 0;
    const isCash = paymentMethod.toUpperCase().includes('CASH');

    // Authoritative 30% AArohan / 70% Driver Settlement
    const settlementResult = financeService.settleCompletedRide({
      rideId: state.activeTrip.id || ('TRIP-AAR-' + Date.now().toString(36).toUpperCase()),
      quoteId: state.activeTrip.quoteId,
      versionId: 'AAROHAN-PRICE-V1',
      categoryId: state.activeTrip.tierId || 'cab',
      driverId: state.driver?.id || 'DRV-MW-101',
      riderId: state.rider?.id || 'USR-RIDER-1',
      grossFare: fare,
      driverTip,
      bookingFee: 150,
      paymentMethod,
      pickupAddress: state.activeTrip.pickup,
      destinationAddress: state.activeTrip.destination
    });

    const breakdown = settlementResult.breakdown;
    const netDriverEarnings = breakdown.totalDriverNetEarnings; // 70% share + 100% tip
    const platformCommission = breakdown.commissionAmount; // 30% AArohan commission

    // Update Rider Balance
    if (!isCash) {
      state.rider.walletBalance = Math.max(0, state.rider.walletBalance - fare);
    }
    state.rider.tripsCompleted += 1;

    // Update Driver State
    if (!isCash) {
      state.driver.availableBalance += netDriverEarnings; // Available for digital cashout
    }
    state.driver.todayEarnings += netDriverEarnings;
    state.driver.todayTrips += 1;
    state.driver.tripsCompleted += 1;

    const destStr = typeof state.activeTrip.destination === 'string'
      ? state.activeTrip.destination
      : (state.activeTrip.destination?.name || state.activeTrip.destination?.address || 'Destination');
    const pickupStr = typeof state.activeTrip.pickup === 'string'
      ? state.activeTrip.pickup
      : (state.activeTrip.pickup?.name || state.activeTrip.pickup?.address || 'Pickup');
    const methodStr = typeof paymentMethod === 'string' ? paymentMethod.split(' ')[0] : 'Digital';

    state.transactionLogs.unshift({
      id: 'TX-' + Math.floor(100 + Math.random() * 900),
      type: 'TRIP',
      title: `Trip to ${destStr.split(',')[0]}`,
      amount: -fare,
      method: isCash ? 'Cash' : methodStr,
      time: 'Just now',
      status: 'Completed'
    });

    state.driverSettlements.unshift({
      id: 'DS-' + Math.floor(200 + Math.random() * 800),
      title: `${pickupStr.split(',')[0]} to ${destStr.split(',')[0]}`,
      amount: netDriverEarnings,
      method: isCash ? 'Cash Collected (70% Net + 30% Debt Owed)' : 'Instant Escrow Credit (70% Net)',
      time: 'Just now',
      status: isCash ? 'Cash In Hand' : 'Instant Settled',
      commissionAmount: platformCommission,
      commissionRate: 0.30
    });

    persistState();
    io.emit('trip:completed', {
      trip: state.activeTrip,
      rider: state.rider,
      driver: state.driver,
      settlement: breakdown,
      commission: settlementResult.commissionEntry,
      driverEarnings: settlementResult.driverEntry
    });
    io.emit('state:sync', state);
  });

  // 7. Rider Rating & Driver Tip
  socket.on('trip:rate', (review) => {
    console.log('[RealTime] Rider submitted rating & tip:', review);
    state.activeTrip.rating = review.rating || 5;
    const tip = review.tip || 0;

    if (tip > 0) {
      state.rider.walletBalance = Math.max(0, state.rider.walletBalance - tip);
      state.driver.availableBalance += tip;
      state.driver.todayEarnings += tip;

      state.driverSettlements.unshift({
        id: 'DS-TIP-' + Math.floor(100 + Math.random() * 900),
        title: 'Passenger Gratuity (Chisomo)',
        amount: tip,
        method: '100% Direct Driver Tip',
        time: 'Just now',
        status: 'Direct Credited'
      });
    }

    persistState();
    io.emit('trip:rated', { review, rider: state.rider, driver: state.driver });
    io.emit('state:sync', state);
  });

  // 8. Trip Cancelled
  socket.on('trip:cancel', (reason) => {
    console.log('[RealTime] Trip cancelled:', reason);
    state.activeTrip.status = 'IDLE';
    persistState();
    io.emit('trip:cancelled', { reason });
    io.emit('state:sync', state);
  });

  // 9. Real-Time Chat (Rider <-> Driver)
  socket.on('chat:send', (msg) => {
    console.log('[RealTime Chat]', msg.sender, ':', msg.text);
    const messageObj = {
      sender: msg.sender,
      text: msg.text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    state.chatMessages.push(messageObj);
    persistState();
    io.emit('chat:message', messageObj);
  });

  // 10. SOS Emergency Alert Trigger
  socket.on('sos:trigger', (data) => {
    console.warn('[RealTime SOS Alert!]', data);
    const alertItem = {
      id: 'SOS-' + Date.now().toString().slice(-4),
      source: data.source || 'RIDER',
      passenger: state.rider.name,
      driver: state.driver.name,
      location: data.location || 'Kenyatta Drive, Lilongwe',
      lat: data.lat || -13.9722,
      lng: data.lng || 33.7667,
      riderPhone: data.riderPhone || state.rider.phone || '+265991234567',
      emergencyPhone: data.emergencyPhone || '+265999970000',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'ACTIVE_DISPATCH_ALERT',
      note: data.note || 'Emergency assistance requested on corridor'
    };
    state.emergencyAlerts.unshift(alertItem);
    persistState();
    io.emit('sos:alert', alertItem);
    io.emit('state:sync', state);

    // Dispatch out-of-band SMS & WhatsApp alerts to Police 997, Security Desk, and Emergency Contact
    notificationService.sendEmergencySosAlert(alertItem).catch(err => {
      console.warn('[NotificationService] SOS broadcast exception:', err.message);
    });
  });

  // 11. SOS Resolution (from Admin desk)
  socket.on('sos:resolve', (id) => {
    state.emergencyAlerts = state.emergencyAlerts.filter(a => a.id !== id);
    persistState();
    io.emit('sos:resolved', id);
    io.emit('state:sync', state);
  });

  // 12. Dynamic Surge Multiplier Update (Admin)
  socket.on('surge:update', (data) => {
    state.surgeMultipliers[data.zone] = parseFloat(data.multiplier);
    persistState();
    io.emit('surge:updated', data);
    io.emit('state:sync', state);
  });

  // 13. Rider Wallet Top Up (Airtel Money / TNM Mpamba)
  socket.on('wallet:topup', (data) => {
    const amt = parseInt(data.amount) || 10000;
    const provider = data.provider || 'Airtel Money';
    state.rider.walletBalance += amt;
    state.transactionLogs.unshift({
      id: 'TX-' + Math.floor(100 + Math.random() * 900),
      type: 'TOPUP',
      title: `Top Up from ${provider}`,
      amount: amt,
      method: provider,
      time: 'Just now',
      status: 'Success'
    });
    persistState();
    io.emit('wallet:updated', { rider: state.rider, tx: state.transactionLogs[0] });
    io.emit('state:sync', state);
  });

  // 14. P2P Kwacha Transfer
  socket.on('wallet:transfer', (data) => {
    const amt = parseInt(data.amount) || 0;
    if (state.rider.walletBalance >= amt && amt > 0) {
      state.rider.walletBalance -= amt;
      state.transactionLogs.unshift({
        id: 'TX-' + Math.floor(100 + Math.random() * 900),
        type: 'TRANSFER',
        title: `Transfer to ${data.phone}`,
        amount: -amt,
        method: 'Mwendo P2P Kwacha',
        time: 'Just now',
        status: 'Completed'
      });
      persistState();
      io.emit('wallet:updated', { rider: state.rider, tx: state.transactionLogs[0] });
      io.emit('state:sync', state);
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

// Start Server
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
