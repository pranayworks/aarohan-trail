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

// Modular Socket Handlers
const setupSockets = require('./sockets');

// Refuse startup if auth secrets are missing or insecure
authService.assertAuthSecrets();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Attach io to app and dispatchService
app.set('io', io);
dispatchService.setSocketServer(io);

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
      io.to(`trip:${trip.id}`).emit('trip:expired', { tripId: trip.id, status: 'NO_DRIVERS' });
      io.emit('trip:expired', { tripId: trip.id, status: 'NO_DRIVERS' });
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
// SECURITY MIDDLEWARE: Helmet, CORS Allowlist & General Rate Limiting
// =========================================================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  `http://${LOCAL_IP}:${PORT}`,
  'http://localhost:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true
}));

const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP address. Please try again after 15 minutes.' }
});
app.use('/api/', generalApiLimiter);

app.use(express.json());

// Public API endpoints whitelist
const PUBLIC_API_ROUTES = [
  '/api/health',
  '/api/network-info',
  '/api/map-config',
  '/api/places/reverse',
  '/api/places/search',
  '/api/search-locations',
  '/api/rides/quote',
  '/api/drivers/nearby',
  '/api/reset'
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

// Health check endpoint
app.get('/api/health', (req, res) => res.json({ status: 'HEALTHY', platform: 'AArohan Mobility', timestamp: new Date().toISOString() }));

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

app.use('/rider', express.static(path.join(__dirname, 'rider'), noCacheStatic));
app.use('/driver', express.static(path.join(__dirname, 'driver'), noCacheStatic));
app.use('/admin', express.static(path.join(__dirname, 'admin'), noCacheStatic));
app.use('/shared', express.static(path.join(__dirname, 'shared'), noCacheStatic));

// Ecosystem landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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

// =========================================================================
// MOUNT MODULAR API ROUTERS
// =========================================================================
app.use('/api/auth', authRouter);
app.use('/api', ridesRouter);
app.use('/api', driversRouter);
app.use('/api', adminRouter);
app.use('/api', paymentsRouter);
app.use('/api', notificationsRouter);
app.use('/api', devRouter);

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
  dbLedger
};

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
