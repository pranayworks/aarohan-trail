const express = require('express');
const { z } = require('zod');
const { rateLimit } = require('express-rate-limit');
const prisma = require('../lib/prisma');
const pricingService = require('../services/pricing');
const locationService = require('../services/location');
const dispatchService = require('../services/dispatch');
const dbLedger = require('../services/dbLedger');
const { requireAuth, requireRole, validateBody } = require('../middleware/auth');
const {
  MALAWI_LOCATIONS,
  DEFAULT_ORIGIN,
  formatLocationResult
} = require('../data/malawiLocations');

const router = express.Router();

// Rate limiter for location search
const discoveryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' }
});

// Zod Validation Schemas
const restQuoteSchema = z.object({
  pickup: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string().optional(),
    address: z.string().optional()
  }),
  destination: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string().optional(),
    address: z.string().optional()
  }).optional(),
  dropoff: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string().optional(),
    address: z.string().optional()
  }).optional(),
  stops: z.array(z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    name: z.string().optional(),
    address: z.string().optional()
  })).max(2).optional(),
  serviceType: z.enum(['RIDE', 'PARCEL']).optional(),
  parcelSize: z.enum(['SMALL', 'MEDIUM', 'LARGE']).optional(),
  surgeMultiplier: z.number().min(1.0).max(5.0).optional()
}).refine(data => data.destination || data.dropoff, {
  message: "Either 'destination' or 'dropoff' must be provided",
  path: ['destination']
}).transform(data => ({
  ...data,
  destination: data.destination || data.dropoff
}));

const restRideCompleteSchema = z.object({
  rideId: z.string().min(1, 'rideId is required'),
  driverTip: z.number().nonnegative().optional(),
  paymentMethod: z.string().optional()
});

const restSavedPlaceSchema = z.object({
  name: z.string().min(1, 'Place name is required'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().optional(),
  address: z.string().optional()
});

// Saved places are PER USER (in memory for now) and never shared between riders.
const savedPlacesByUser = new Map();
const defaultSavedPlaces = () => [
  { id: 'PLC-home', label: 'Home', name: 'Area 47 Sector 3', address: 'Area 47 Sector 3, Kaunda Road', lat: -13.9632, lng: 33.7741 },
  { id: 'PLC-work', label: 'Work', name: 'Capital City Centre', address: 'Capital City Centre, Robert Mugabe Cres', lat: -13.9512, lng: 33.7891 },
  { id: 'PLC-eptl', label: 'Work', name: 'Entire Printers & Traders Limited (EPTL)', address: 'Area 4 Industrial Corridor, Lilongwe', lat: -13.9933, lng: 33.6777 }
];
function savedPlacesFor(userId) {
  if (!savedPlacesByUser.has(userId)) savedPlacesByUser.set(userId, defaultSavedPlaces());
  return savedPlacesByUser.get(userId);
}

// 1. Authoritative Route & Dynamic Pricing Quote (with Service Area & Stops)
router.post('/rides/quote', validateBody(restQuoteSchema), async (req, res) => {
  try {
    const { pickup, destination, stops = [], serviceType = 'RIDE', parcelSize = 'SMALL', surgeMultiplier } = req.body;

    // Service-area check: Lilongwe Bounding Box enforcement
    if (!locationService.isWithinServiceArea(pickup.lat, pickup.lng)) {
      return res.status(400).json({
        error: 'Pickup location is outside the AArohan Lilongwe service area. Service is currently only available within the greater Lilongwe corridor.',
        code: 'OUTSIDE_SERVICE_AREA',
        point: 'pickup',
        coords: { lat: pickup.lat, lng: pickup.lng }
      });
    }

    if (!locationService.isWithinServiceArea(destination.lat, destination.lng)) {
      return res.status(400).json({
        error: 'Destination is outside the AArohan Lilongwe service area. Service is currently only available within the greater Lilongwe corridor.',
        code: 'OUTSIDE_SERVICE_AREA',
        point: 'destination',
        coords: { lat: destination.lat, lng: destination.lng }
      });
    }

    if (Array.isArray(stops)) {
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        if (!locationService.isWithinServiceArea(s.lat, s.lng)) {
          return res.status(400).json({
            error: `Stop ${i + 1} (${s.name || 'intermediate'}) is outside the AArohan Lilongwe service area.`,
            code: 'OUTSIDE_SERVICE_AREA',
            point: `stop_${i + 1}`,
            coords: { lat: s.lat, lng: s.lng }
          });
        }
      }
    }

    if (!pickup.name) {
      const rev = await locationService.reverseGeocode(pickup.lat, pickup.lng);
      pickup.name = rev.title || rev.displayName;
    }
    if (!destination.name) {
      const rev = await locationService.reverseGeocode(destination.lat, destination.lng);
      destination.name = rev.title || rev.displayName;
    }

    const route = await locationService.getRoadRoute(pickup, destination, stops);
    const quote = pricingService.generateQuote({
      pickup,
      destination,
      stops,
      distanceKm: route.distanceKm,
      durationMins: route.durationMins,
      routeGeometry: route.polyline,
      // Fair-price promise: the price never rises with demand unless SURGE_ENABLED=true is set on the server.
      // Whatever a client sends is ignored otherwise.
      surgeMultiplier: (process.env.SURGE_ENABLED === 'true' && surgeMultiplier) ? surgeMultiplier : 1.0,
      serviceType,
      parcelSize
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
      stops: quote.stops || [],
      stopCount: quote.stopCount || 0,
      stopFeeMWK: quote.stopFeeMWK || 0,
      serviceType: quote.serviceType,
      parcelSize: quote.parcelSize,
      quote
    });
  } catch (err) {
    console.error('[PricingQuote] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to calculate route and fare quote' });
  }
});

// 2. Reverse Geocoding
router.get('/places/reverse', async (req, res) => {
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

// 3. Forward Geocoding & Autocomplete
router.get('/places/search', async (req, res) => {
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

// 4. Ride completion over REST is RETIRED. Trips complete only through the realtime
// `trip:complete` flow, which enforces driver ownership, IN_TRANSIT status and the
// rider's safety PIN, and takes the payment method and tip from the stored trip.
router.post('/rides/complete', requireRole('DRIVER', 'ADMIN'), validateBody(restRideCompleteSchema), (req, res) => {
  res.status(410).json({
    error: 'This endpoint has been retired. Trips are completed from the driver app after the rider PIN is verified.',
    code: 'ENDPOINT_RETIRED'
  });
});

// 5. Active Trips Lookup (DB Query with strict user isolation)
router.get('/trips/active', requireAuth, async (req, res) => {
  try {
    const isDriver = req.user.role === 'DRIVER';
    const whereCondition = isDriver && req.user.driverId
      ? { driverId: req.user.driverId }
      : { riderId: req.user.id };

    const activeTrip = await prisma.trip.findFirst({
      where: {
        ...whereCondition,
        status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
      },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        parcelDetail: true,
        rider: { select: { id: true, name: true, phone: true } },
        driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } }
      }
    });
    if (activeTrip && req.user.role === 'DRIVER' && activeTrip.parcelDetail) {
      activeTrip.parcelDetail = dispatchService.safeParcel(activeTrip.parcelDetail); // never send the delivery code hash to a driver
    }
    res.json({ activeTrip: activeTrip || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b. User Past & Cancelled Trips History
router.get('/trips/history', requireAuth, async (req, res) => {
  try {
    const isDriver = req.user.role === 'DRIVER';
    const whereCondition = isDriver && req.user.driverId
      ? { driverId: req.user.driverId }
      : { riderId: req.user.id };

    const trips = await prisma.trip.findMany({
      where: {
        ...whereCondition,
        OR: [
          { status: { in: ['COMPLETED', 'CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'EXPIRED', 'NO_DRIVERS'] } },
          // a request nobody ever answered and that is no longer live still belongs in the history
          { status: { in: ['REQUESTED', 'OFFERED'] }, createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } }
        ]
      },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } },
        rider: { select: { id: true, name: true, phone: true } },
        ratings: { where: { fromUserId: req.user.id } },
        supportTickets: { select: { id: true, status: true, subject: true } },
        parcelDetail: true
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json({ success: true, trips });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chat history for one trip. Only the rider and the assigned driver can read it.
router.get('/trips/:id/chat', requireAuth, async (req, res) => {
  try {
    const trip = await prisma.trip.findUnique({
      where: { id: req.params.id },
      select: { id: true, riderId: true, driver: { select: { userId: true } } }
    });
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    const isMember = req.user.id === trip.riderId || (trip.driver && trip.driver.userId === req.user.id);
    if (!isMember) return res.status(403).json({ error: 'Forbidden: you are not part of this trip' });

    const rows = await prisma.chatMessage.findMany({
      where: { tripId: trip.id },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, senderRole: true, text: true, createdAt: true }
    });
    res.json({
      success: true,
      messages: rows.map(r => ({ id: r.id, sender: r.senderRole === 'DRIVER' ? 'driver' : 'rider', text: r.text, createdAt: r.createdAt }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. User Saved Places (per user)
router.get('/user/saved-places', requireAuth, (req, res) => {
  res.json(savedPlacesFor(req.user.id));
});

router.post('/user/saved-places', requireAuth, validateBody(restSavedPlaceSchema), (req, res) => {
  const { label, name, address, lat, lng } = req.body;
  const newPlace = {
    id: 'PLC-' + Date.now().toString(36),
    label: label || 'Custom',
    name,
    address: address || name,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    createdAt: Date.now()
  };

  let list = savedPlacesFor(req.user.id);
  if (label && ['Home', 'Work'].includes(label)) {
    list = list.filter(p => p.label !== label);
  }
  list.push(newPlace);
  savedPlacesByUser.set(req.user.id, list);
  res.json({ success: true, savedPlace: newPlace, savedPlaces: list });
});

router.delete('/user/saved-places/:id', requireAuth, (req, res) => {
  const list = savedPlacesFor(req.user.id).filter(p => p.id !== req.params.id);
  savedPlacesByUser.set(req.user.id, list);
  res.json({ success: true, savedPlaces: list });
});

// 7. Frequent places: only THIS rider's own completed trips (never other riders' destinations)
router.get('/user/frequent-places', requireAuth, async (req, res) => {
  try {
    const completedTrips = await prisma.trip.findMany({
      where: { riderId: req.user.id, status: 'COMPLETED' },
      select: { dropoffAddress: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    const counts = new Map();
    completedTrips.forEach(t => {
      const dest = (t.dropoffAddress || '').split(',')[0].trim();
      if (dest) counts.set(dest, (counts.get(dest) || 0) + 1);
    });

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

// 8. Location Search with Malawi Gazetteer & OpenStreetMap
router.get('/search-locations', discoveryLimiter, async (req, res) => {
  const query = (req.query.q || '').trim();
  const originLat = parseFloat(req.query.lat) || DEFAULT_ORIGIN.lat;
  const originLng = parseFloat(req.query.lng) || DEFAULT_ORIGIN.lng;

  if (!query) {
    const popular = MALAWI_LOCATIONS.slice(0, 8).map(loc => formatLocationResult(loc, originLat, originLng));
    return res.json(popular);
  }

  const qLower = query.toLowerCase();

  const localMatches = MALAWI_LOCATIONS.filter(loc => {
    return loc.name.toLowerCase().includes(qLower) ||
      loc.area.toLowerCase().includes(qLower) ||
      (loc.tags && loc.tags.some(tag => tag.toLowerCase().includes(qLower)));
  }).map(loc => formatLocationResult(loc, originLat, originLng));

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
            const coords = f.geometry.coordinates;
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
    // Graceful offline fallback
  }

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

module.exports = router;
