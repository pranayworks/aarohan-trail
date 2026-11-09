require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

const pricingService = require('./services/pricing');
const locationService = require('./services/location');
const dispatchService = require('./services/dispatch');
const financeService = require('./services/finance');
const featureFlags = require('./services/featureFlags');
const paymentManager = require('./services/payments');
const notificationService = require('./services/notifications');
const prisma = require('./lib/prisma');
const dbLedger = require('./services/dbLedger');
const authService = require('./services/auth');
const { requireAuth } = require('./middleware/auth');

// Modular Routers
const authRouter = require('./routes/auth');
const ridesRouter = require('./routes/rides');
const driversRouter = require('./routes/drivers');
const adminRouter = require('./routes/admin');
const paymentsRouter = require('./routes/payments');
const notificationsRouter = require('./routes/notifications');
const devRouter = require('./routes/dev');
const ticketsRouter = require('./routes/tickets');
const legalRouter = require('./routes/legal');
const sosRouter = require('./routes/sos');
const meRouter = require('./routes/me');
const adminUsersRouter = require('./routes/adminUsers');
const driverApplicationRouter = require('./routes/driverApplication');
const adsRouter = require('./routes/ads');
const adminDataRouter = require('./routes/adminData');

// Modular Socket Handlers
const setupSockets = require('./sockets');

const { validateStartupConfig } = require('./services/configValidator');
const { logger } = require('./services/logger');
const sentry = require('./services/sentry');

// Refuse startup if auth secrets or production configs are missing or insecure
authService.assertAuthSecrets();
validateStartupConfig();

const PORT = process.env.PORT || 3000;

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

// Dynamic CORS allowlist driven by APP_ORIGINS env variable
function getAllowedOrigins() {
  const envOrigins = (process.env.APP_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const localOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    `http://${LOCAL_IP}:${PORT}`,
    'http://localhost:5173'
  ];

  return [...new Set([...localOrigins, ...envOrigins])];
}

const app = express();

// Trust proxy configuration driven by TRUST_PROXY (default 1 in production)
const trustProxyEnv = process.env.TRUST_PROXY;
const trustProxyVal = trustProxyEnv !== undefined
  ? (!isNaN(Number(trustProxyEnv)) ? Number(trustProxyEnv) : (trustProxyEnv === 'true' ? true : (trustProxyEnv === 'false' ? false : trustProxyEnv)))
  : (process.env.NODE_ENV === 'production' ? 1 : false);
app.set('trust proxy', trustProxyVal);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const origins = getAllowedOrigins();
      if (origins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Attach io to app and dispatchService
app.set('io', io);
dispatchService.setSocketServer(io);

// =========================================================================
// STALE TRIPS WATCHDOG (Moves REQUESTED/OFFERED trips > 3 mins to NO_DRIVERS)
// =========================================================================
async function expireStaleTrips() {
  try {
    const cutoff = new Date(Date.now() - 3 * 60 * 1000);
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
      io.to(`trip:${trip.id}`).to(`user:${trip.riderId}`).emit('trip:expired', { tripId: trip.id, status: 'NO_DRIVERS' });
    }
    return staleTrips;
  } catch (err) {
    console.error('[StaleTripWatchdog] Error:', err.message);
    return [];
  }
}

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

// =========================================================================
// SECURITY MIDDLEWARE: Helmet (Strict CSP), CORS Allowlist & Rate Limiting
// =========================================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://api.mapbox.com', 'https://cdn.jsdelivr.net', 'https://accounts.google.com'],
      frameSrc: ["'self'", 'https://accounts.google.com'],
      // The app screens use inline onclick="..." handlers. Helmet's default `script-src-attr 'none'`
      // silently disables EVERY one of them, so it must be allowed explicitly.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://api.mapbox.com', 'https://fonts.googleapis.com', 'https://accounts.google.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.supabase.co', 'https://api.mapbox.com', 'https://*.tile.openstreetmap.org', 'https://*.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://api.maptiler.com', 'https://lh3.googleusercontent.com'],
      mediaSrc: ["'self'", 'blob:', 'https://*.supabase.co'], // ad videos
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https://api.mapbox.com', 'https://events.mapbox.com', 'https://api.maptiler.com', 'https://nominatim.openstreetmap.org', '*.sentry.io', 'https://accounts.google.com', 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com'], // the last two load the face-detection model for the driver face check
      workerSrc: ["'self'", 'blob:'],
      childSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // Only force HTTPS in production, so the app can still be tested over http on a LAN.
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  const base = { credentials: true };
  if (!origin) return callback(null, { ...base, origin: true });
  // The app's own address is always allowed (its pages call its own API).
  let sameSite = false;
  try { sameSite = new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim(); } catch (_) { /* bad origin header */ }
  const origins = getAllowedOrigins();
  if (sameSite || origins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return callback(null, { ...base, origin: true });
  }
  return callback(new Error(`CORS blocked for origin: ${origin}`));
}));

// Global API rate limiter (300 requests / 15 mins)
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP address. Please try again after 15 minutes.' }
});
app.use('/api/', generalApiLimiter);

// Per-IP Auth rate limiter (30 requests / 15 mins)
const authIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts from this IP address. Please wait 15 minutes.' }
});
app.use('/api/auth/', authIpLimiter);

app.use(express.json());
app.use(logger.httpMiddleware());

// Public API endpoints whitelist
const PUBLIC_API_ROUTES = [
  '/api/health',
  '/api/ready',
  '/api/app-config',
  '/api/app-version',
  '/api/network-info',
  '/api/map-config',
  '/api/places/reverse',
  '/api/places/search',
  '/api/search-locations',
  '/api/rides/quote',
  '/api/drivers/nearby',
  '/api/reset',
  '/api/dev/simulate-location'
];

// Global Deny-by-Default Middleware for all /api/ Routes
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path.startsWith('/payments/webhook')) {
    return next();
  }
  const fullPath = '/api' + (req.path === '/' ? '' : req.path);
  if (PUBLIC_API_ROUTES.includes(fullPath)) {
    return next();
  }
  return requireAuth(req, res, next);
});

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Basic Health check endpoint (Fast process health, zero secrets)
app.get('/api/health', (req, res) => {
  return res.status(200).json({
    status: 'HEALTHY',
    platform: 'Aarohan Mobility',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: 'CONNECTED',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Readiness probe (Database ping check, zero secrets)
app.get('/api/ready', async (req, res) => {
  let dbStatus = 'CONNECTED';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'DISCONNECTED';
  }

  const isReady = dbStatus === 'CONNECTED';
  const responseData = {
    status: isReady ? 'READY' : 'NOT_READY',
    platform: 'Aarohan Mobility',
    database: dbStatus,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development'
  };

  return res.status(isReady ? 200 : 503).json(responseData);
});

// Serve static apps
const noCacheStatic = {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
};

// The new apps are now THE apps. The old ones stay reachable at /rider/index.html and /driver/index.html for reference.
app.get(['/rider', '/rider/'], (req, res) => res.redirect(302, '/rider/next/'));
app.get(['/driver', '/driver/'], (req, res) => res.redirect(302, '/driver/next/'));
// Ad pictures and videos saved on this computer during development (production uses the public Supabase bucket).
app.use('/media/ads', express.static(path.join(__dirname, 'uploads', 'ads'), { maxAge: '7d', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use('/rider', express.static(path.join(__dirname, 'rider'), noCacheStatic));
app.use('/driver', express.static(path.join(__dirname, 'driver'), noCacheStatic));
app.use('/admin', express.static(path.join(__dirname, 'admin'), noCacheStatic));
app.use('/shared', express.static(path.join(__dirname, 'shared'), noCacheStatic));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
// Map library served by us (faster on slow networks, no third-party script). Installed by `npm install` (leaflet@1.9.4).
const LEAFLET_DIR = path.join(__dirname, 'node_modules', 'leaflet', 'dist');
if (!require('fs').existsSync(path.join(LEAFLET_DIR, 'leaflet.js'))) {
  console.warn('[Maps] node_modules/leaflet is missing: run `npm install`. Maps will not load until it is installed.');
}
app.use('/vendor/leaflet', express.static(LEAFLET_DIR, { maxAge: '30d', immutable: true }));
// Face-detection files for the driver face check, hosted here so it never depends on an outside website (npm run setup:face).
app.use('/vendor/mediapipe', express.static(path.join(__dirname, 'vendor', 'mediapipe'), { maxAge: '30d', immutable: true }));

// Prototypes (strictly blocked in production)
app.use('/prototypes', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).send('Not Found');
  }
  next();
}, express.static(path.join(__dirname, 'prototypes'), noCacheStatic));

// Public landing page (also the website link shared with SMS and payment providers)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

// Network info & QR code
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

// Map Configuration
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

// App Configuration (service area, env, flags)
// Play Store / web update check. Set APP_LATEST_VERSION when you publish a new build, and
// APP_MIN_VERSION to force everyone below it to update. PLAY_STORE_URL is the listing link.
const semverParts = (v) => String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
const semverLess = (a, b) => { const x = semverParts(a), y = semverParts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
const BUILD_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.BUILD_ID || String(Date.now());
app.get('/api/app-version', (req, res) => {
  const app_ = String(req.query.app || 'rider') === 'driver' ? 'DRIVER' : 'RIDER';
  const latest = process.env[`APP_${app_}_LATEST_VERSION`] || process.env.APP_LATEST_VERSION || '1.0.0';
  const min = process.env[`APP_${app_}_MIN_VERSION`] || process.env.APP_MIN_VERSION || '1.0.0';
  const current = String(req.query.version || '0.0.0').slice(0, 20);
  res.json({
    latest, min, current, build: BUILD_ID,
    updateAvailable: semverLess(current, latest),
    forced: semverLess(current, min),
    storeUrl: process.env[`PLAY_STORE_URL_${app_}`] || process.env.PLAY_STORE_URL || '',
    message: process.env.APP_UPDATE_MESSAGE || 'A new version of Aarohan is ready with fixes and improvements.'
  });
});

app.get('/api/app-config', (req, res) => {
  res.json({
    platform: 'Aarohan Mobility',
    appName: 'Aarohan Smart Urban Mobility Platform',
    serviceDescription: 'Real-time urban ride-hailing and parcel logistics ecosystem for Lilongwe, Malawi',
    googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim() || null,
    contactEmail: process.env.CONTACT_EMAIL || process.env.SUPPORT_EMAIL || '',
    env: process.env.NODE_ENV || 'development',
    allowLocationSimulation: (process.env.NODE_ENV || 'development') === 'development',
    paymentsEnabled: featureFlags.paymentsEnabled(),
    authMode: featureFlags.authMode(),
    sentryDsn: (process.env.SENTRY_DSN || '').trim(),
    serviceArea: {
      city: 'Lilongwe',
      country: 'Malawi',
      bbox: locationService.getServiceAreaBBox ? locationService.getServiceAreaBBox() : locationService.LILONGWE_SERVICE_BBOX
    }
  });
});

// =========================================================================
// MOUNT MODULAR API ROUTERS
// =========================================================================
app.use(legalRouter);
app.use('/api/auth', authRouter);
app.use('/api', ridesRouter);
app.use('/api', driversRouter);
app.use('/api', adminRouter);
app.use('/api', paymentsRouter);
app.use('/api', sosRouter);
app.use('/api', meRouter);
app.use('/api', adminUsersRouter);
app.use('/api', driverApplicationRouter);
app.use('/api', adsRouter);
app.use('/api', adminDataRouter);
app.use('/api', notificationsRouter);
app.use('/api', devRouter);
app.use('/api', ticketsRouter);

// Sentry Error Handler Middleware
app.use(sentry.expressErrorHandler());

// =========================================================================
// SETUP SOCKET.IO ENGINE
// =========================================================================
setupSockets(io, operationalState);

// Resume any pending dispatch offers from database
dispatchService.resumePendingOffers();

module.exports = {
  server,
  app,
  io,
  expireStaleTrips,
  dispatchService,
  pricingService,
  financeService,
  authService,
  locationService,
  notificationService,
  paymentManager,
  dbLedger,
  tripRecord: require('./services/tripRecord'),
  ratingService: require('./services/rating'),
  supportTicketService: require('./services/supportTicket')
};

// Start Server
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    try { require('./services/driverReminders').start(); } catch (e) { console.warn('[Reminders] not started:', e.message); }
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
