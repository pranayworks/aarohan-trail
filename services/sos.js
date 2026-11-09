// ============================================================================
// Aarohan SOS service: ONE implementation used by both the realtime socket event
// and the HTTP backup route, so they can never drift apart.
// Identity, phone numbers and emergency contacts always come from the DATABASE
// (never from the request), and alerts go to ops staff only.
// ============================================================================

const { z } = require('zod');
const prisma = require('../lib/prisma');
const notificationService = require('./notifications');
const { emitToOps } = require('../sockets/emitters');

// Extra fields a client may send (riderPhone, emergencyPhone...) are accepted but IGNORED.
const sosPayloadSchema = z.object({
  tripId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  note: z.string().optional(),
  location: z.string().optional(),
  source: z.string().optional(),
  riderPhone: z.string().optional(),
  emergencyPhone: z.string().optional()
});

const LILONGWE_CENTRE = { lat: -13.9626, lng: 33.7873 };
const validCoord = (v, limit) => Number.isFinite(v) && Math.abs(v) <= limit;
const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function triggerSos({ userId, role, driverId = null, data, io = null }) {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, emergencyContactName: true, emergencyContactPhone: true }
  });
  if (!me) throw new Error('Account not found');

  // All of the rider's emergency contacts (up to 3). Older accounts only have the single contact on the user.
  let contacts = [];
  try {
    if (prisma.emergencyContact && prisma.emergencyContact.findMany) {
      contacts = await prisma.emergencyContact.findMany({ where: { userId: me.id }, orderBy: { position: 'asc' }, select: { name: true, phone: true } });
    }
  } catch (_) { /* the single contact below still works */ }

  // One incident per person per minute: a repeated press returns the same incident.
  const recent = await prisma.sosEvent.findFirst({
    where: { userId: me.id, status: 'ACTIVE', createdAt: { gte: new Date(Date.now() - 60 * 1000) } },
    orderBy: { createdAt: 'desc' }
  });
  if (recent) {
    return {
      duplicate: true,
      alert: {
        id: recent.id,
        source: role || 'RIDER',
        lat: recent.lat,
        lng: recent.lng,
        time: nowLabel(),
        status: 'ACTIVE_DISPATCH_ALERT',
        note: recent.notes
      }
    };
  }

  // Only link a trip the caller really belongs to.
  let trip = null;
  if (data.tripId) {
    const ownership = [{ riderId: me.id }];
    if (driverId) ownership.push({ driverId });
    trip = await prisma.trip.findFirst({
      where: { id: data.tripId, OR: ownership },
      select: {
        id: true,
        pickupLat: true,
        pickupLng: true,
        driver: { select: { user: { select: { name: true, phone: true } } } },
        rider: { select: { name: true, phone: true } }
      }
    });
  }

  let lat = data.lat;
  let lng = data.lng;
  let locationKnown = validCoord(lat, 90) && validCoord(lng, 180);
  let approximate = false;
  if (!locationKnown && trip) {
    lat = trip.pickupLat;
    lng = trip.pickupLng;
    locationKnown = true;
    approximate = true;
  }
  if (!locationKnown) {
    lat = LILONGWE_CENTRE.lat; // flagged below as unknown
    lng = LILONGWE_CENTRE.lng;
  }

  let note = String(data.note || 'Emergency assistance requested').slice(0, 300);
  if (approximate) note += ' [APPROXIMATE: trip pickup location]';
  if (!locationKnown) note += ' [LOCATION UNKNOWN: no GPS received]';

  const sosEvent = await prisma.sosEvent.create({
    data: { tripId: trip ? trip.id : null, userId: me.id, lat, lng, notes: note, status: 'ACTIVE' }
  });

  await prisma.auditLog.create({
    data: {
      userId: me.id,
      action: 'SOS_TRIGGERED',
      entityType: 'SOS',
      entityId: sosEvent.id,
      details: { tripId: trip ? trip.id : null, locationKnown, approximate }
    }
  }).catch((e) => console.warn('[SOS] Audit log failed:', e.message));

  const alert = {
    id: sosEvent.id,
    source: role || 'RIDER',
    passenger: me.name || null,
    driver: trip?.driver?.user?.name || null,
    location: data.location ? String(data.location).slice(0, 200) : null,
    lat,
    lng,
    locationKnown,
    locationApproximate: approximate,
    riderPhone: me.phone,
    emergencyContactName: me.emergencyContactName || null,
    emergencyPhone: me.emergencyContactPhone || null,
    emergencyContacts: contacts,
    time: nowLabel(),
    status: 'ACTIVE_DISPATCH_ALERT',
    note
  };

  // Operations staff only: SOS details are never sent to other riders or drivers.
  emitToOps(io, 'sos:alert', alert);
  Promise.resolve(notificationService.sendEmergencySosAlert(alert)).catch((err) => {
    console.warn('[SOS] Notification broadcast failed:', err.message);
  });

  return { duplicate: false, alert };
}

// HTTP backup for when the realtime connection is down.
async function handleSosRequest(req, res) {
  try {
    const parsed = sosPayloadSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Invalid SOS payload' });

    const result = await triggerSos({
      userId: req.user.id,
      role: req.user.role,
      driverId: req.user.driverId || null,
      data: parsed.data,
      io: req.app && req.app.get ? req.app.get('io') : null
    });
    res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, alert: result.alert });
  } catch (err) {
    console.error('[SOS] HTTP trigger failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
}

module.exports = { sosPayloadSchema, triggerSos, handleSosRequest };
