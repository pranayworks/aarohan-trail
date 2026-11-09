// ============================================================================
// AAROHAN RIDER PROFILE ROUTES (/api/me/...)
// Personal details, live rating, up to 3 emergency contacts, saved places, rewards, notifications,
// and account deletion. Every route needs a login and only ever touches the caller's own data.
// ============================================================================

const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth, validateBody } = require('../middleware/auth');
const authService = require('../services/auth');
const emailAuth = require('../services/emailAuth');
const { authMode } = require('../services/featureFlags');
const { computeRiderScore } = require('../services/riderScore');

const router = express.Router();

const COINS_PER_TRIP = 10;
const COINS_PER_REFERRAL = 50;
const COINS_WELCOME = 30; // for the new rider who joined with a friend's code
const MAX_CONTACTS = 3;
const MAX_PLACES = 10;
const ACTIVE_STATUSES = ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'];

// ---------------------------------------------------------------------------
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alike characters
function newReferralCode() {
  let s = 'AR';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return s;
}
async function ensureReferralCode(userId) {
  for (let i = 0; i < 6; i++) {
    try {
      const u = await prisma.user.update({ where: { id: userId }, data: { referralCode: newReferralCode() }, select: { referralCode: true } });
      return u.referralCode;
    } catch (err) {
      if (!(err && err.code === 'P2002')) throw err; // only retry on a clash
    }
  }
  return null;
}

function ageOn(dob, now = new Date()) {
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(60, 'Name is too long').optional(),
  email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address').optional(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT']).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must look like 1998-04-23').optional(),
  referralCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,12}$/, 'That referral code does not look right').optional(),
  language: z.enum(['en', 'ny']).optional()
});

const contactsSchema = z.object({
  contacts: z.array(z.object({
    name: z.string().trim().min(2, 'Contact name is too short').max(60),
    phone: z.string().trim().min(9).max(20),
    relation: z.string().trim().max(30).optional()
  })).max(MAX_CONTACTS, `You can add up to ${MAX_CONTACTS} emergency contacts`)
});

const placeSchema = z.object({
  label: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(200).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

// ---------------------------------------------------------------------------
// GET /api/me: everything the Account screens need, in one call
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        emergencyContacts: { orderBy: { position: 'asc' } },
        savedPlaces: { orderBy: { createdAt: 'asc' } }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const referralCode = user.referralCode || await ensureReferralCode(user.id);
    const [rating, referred, completedTrips] = await Promise.all([
      computeRiderScore(prisma, user.id),
      prisma.user.count({ where: { referredById: user.id } }),
      prisma.trip.count({ where: { riderId: user.id, status: 'COMPLETED' } })
    ]);

    res.json({
      success: true,
      profile: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email || null,
        gender: user.gender || null,
        language: user.language || null,
        dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString().slice(0, 10) : null,
        memberSince: user.createdAt,
        role: user.role,
        referralCode,
        referredCount: referred,
        completedTrips,
        emergencyContacts: user.emergencyContacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone, relation: c.relation })),
        savedPlaces: user.savedPlaces.map((p) => ({ id: p.id, label: p.label, name: p.name, address: p.address, lat: p.lat, lng: p.lng })),
        rating
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/me: update personal details
// ---------------------------------------------------------------------------
router.patch('/me', requireAuth, validateBody(profileSchema), async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!me) return res.status(404).json({ error: 'User not found' });

    const data = {};
    const { name, email, gender, dateOfBirth, referralCode, language } = req.body;

    if (name !== undefined) data.name = name;
    if (gender !== undefined) data.gender = gender;
    if (language !== undefined) data.language = language;

    if (dateOfBirth !== undefined) {
      const dob = new Date(dateOfBirth + 'T00:00:00.000Z');
      if (Number.isNaN(dob.getTime())) return res.status(400).json({ error: 'That date of birth is not valid.' });
      const age = ageOn(dob);
      if (age < 18) return res.status(400).json({ error: 'You must be 18 or older to use Aarohan.' });
      if (age > 110) return res.status(400).json({ error: 'That date of birth is not valid.' });
      data.dateOfBirth = dob;
    }

    if (email !== undefined && email !== (me.email || '')) {
      if (authMode() === 'email' && me.email) {
        return res.status(400).json({ error: 'Your email is how you sign in, so it cannot be changed here.' });
      }
      const clash = await prisma.user.findFirst({ where: { email, NOT: { id: me.id } }, select: { id: true } });
      if (clash) return res.status(409).json({ error: 'That email is already used by another account.' });
      data.email = email;
    }

    if (referralCode !== undefined && !me.referredById) {
      const referrer = await prisma.user.findUnique({ where: { referralCode }, select: { id: true } });
      if (!referrer) return res.status(400).json({ error: 'We could not find that referral code.' });
      if (referrer.id === me.id) return res.status(400).json({ error: 'You cannot use your own referral code.' });
      data.referredById = referrer.id;
    }

    if (Object.keys(data).length) {
      await prisma.user.update({ where: { id: me.id }, data });
      await prisma.auditLog.create({
        data: { userId: me.id, action: 'PROFILE_UPDATED', entityType: 'USER', entityId: me.id, details: { fields: Object.keys(data) }, ipAddress: req.ip }
      }).catch(() => {});
    }
    res.json({ success: true, updated: Object.keys(data) });
  } catch (err) {
    if (err && err.code === 'P2002') return res.status(409).json({ error: 'That detail is already used by another account.' });
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/me/emergency-contacts: replace the list (up to 3)
// The first contact is also kept in the older single-contact fields, because SOS reads those.
// ---------------------------------------------------------------------------
router.put('/me/emergency-contacts', requireAuth, validateBody(contactsSchema), async (req, res) => {
  try {
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, phone: true } });
    const seen = new Set();
    const clean = [];
    for (const c of req.body.contacts) {
      const phone = emailAuth.normalizeMalawiPhone(c.phone);
      if (!authService.validateMalawianPhone(phone)) {
        return res.status(400).json({ error: `"${c.phone}" is not a valid mobile number.` });
      }
      if (phone === me.phone) return res.status(400).json({ error: 'Add someone else: that is your own number.' });
      if (seen.has(phone)) return res.status(400).json({ error: 'Each contact needs a different number.' });
      seen.add(phone);
      clean.push({ name: c.name, phone, relation: c.relation || null });
    }

    await prisma.$transaction([
      prisma.emergencyContact.deleteMany({ where: { userId: me.id } }),
      ...clean.map((c, i) => prisma.emergencyContact.create({ data: { userId: me.id, name: c.name, phone: c.phone, relation: c.relation, position: i } })),
      prisma.user.update({
        where: { id: me.id },
        data: { emergencyContactName: clean[0] ? clean[0].name : null, emergencyContactPhone: clean[0] ? clean[0].phone : null }
      })
    ]);
    res.json({ success: true, contacts: clean });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Saved / trusted places (Home, Work, anything the rider chooses)
// ---------------------------------------------------------------------------
router.get('/me/places', requireAuth, async (req, res) => {
  try {
    const places = await prisma.savedPlace.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' } });
    res.json({ success: true, places });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/me/places', requireAuth, validateBody(placeSchema), async (req, res) => {
  try {
    const { label, name, address, lat, lng } = req.body;
    const existing = await prisma.savedPlace.findMany({ where: { userId: req.user.id } });
    const isSlot = ['home', 'work'].includes(label.toLowerCase());
    const sameLabel = isSlot ? existing.filter((p) => p.label.toLowerCase() === label.toLowerCase()) : [];
    if (existing.length - sameLabel.length >= MAX_PLACES) {
      return res.status(400).json({ error: `You can save up to ${MAX_PLACES} places.` });
    }
    if (sameLabel.length) await prisma.savedPlace.deleteMany({ where: { id: { in: sameLabel.map((p) => p.id) }, userId: req.user.id } });
    const place = await prisma.savedPlace.create({ data: { userId: req.user.id, label, name, address: address || null, lat, lng } });
    res.status(201).json({ success: true, place });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/me/places/:id', requireAuth, async (req, res) => {
  try {
    const r = await prisma.savedPlace.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
    if (!r.count) return res.status(404).json({ error: 'Place not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Rewards and Aarohan coins (earned, not bought; redeeming opens later)
// ---------------------------------------------------------------------------
router.get('/me/rewards', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, referralCode: true, referredById: true, createdAt: true } });
    const referralCode = user.referralCode || await ensureReferralCode(user.id);

    const [trips, referred] = await Promise.all([
      prisma.trip.findMany({
        where: { riderId: user.id, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 100,
        select: { id: true, serviceType: true, dropoffAddress: true, completedAt: true }
      }),
      prisma.user.findMany({
        where: { referredById: user.id },
        select: { id: true, name: true, createdAt: true, tripsAsRider: { where: { status: 'COMPLETED' }, take: 1, select: { id: true } } }
      })
    ]);

    const qualified = referred.filter((r) => r.tripsAsRider.length > 0);
    const welcome = user.referredById ? [{ type: 'REFERRAL', title: 'Welcome bonus: you joined with a friend\'s code', detail: '', coins: COINS_WELCOME, at: user.createdAt }] : [];
    const history = [
      ...welcome,
      ...trips.map((t) => ({
        type: t.serviceType === 'PARCEL' ? 'PARCEL' : 'RIDE',
        title: t.serviceType === 'PARCEL' ? 'Parcel delivered' : 'Trip completed',
        detail: t.dropoffAddress,
        coins: COINS_PER_TRIP,
        at: t.completedAt
      })),
      ...qualified.map((r) => ({
        type: 'REFERRAL', title: 'A friend took their first trip', detail: (r.name || 'Friend').split(' ')[0], coins: COINS_PER_REFERRAL, at: r.createdAt
      }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 60);

    res.json({
      success: true,
      coins: trips.length * COINS_PER_TRIP + qualified.length * COINS_PER_REFERRAL + welcome.length * COINS_WELCOME,
      welcomeBonus: COINS_WELCOME,
      joinedWithCode: Boolean(user.referredById),
      perTrip: COINS_PER_TRIP,
      perReferral: COINS_PER_REFERRAL,
      redeemable: false,
      referralCode,
      referredCount: referred.length,
      qualifiedReferrals: qualified.length,
      history
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Notifications: built from the rider's own trips and support tickets
// ---------------------------------------------------------------------------
router.get('/me/notifications', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, createdAt: true } });
    const [trips, tickets] = await Promise.all([
      prisma.trip.findMany({
        where: { riderId: user.id, status: { in: ['COMPLETED', 'CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'EXPIRED'] } },
        orderBy: { updatedAt: 'desc' },
        take: 15,
        select: { id: true, status: true, serviceType: true, dropoffAddress: true, fareMWK: true, updatedAt: true }
      }),
      prisma.supportTicket.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, subject: true, status: true, updatedAt: true, messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { authorRole: true, createdAt: true } } }
      })
    ]);

    const items = [];
    // Driver application progress (received, approved, or needs changes)
    try {
      if (prisma.driver && prisma.driver.findFirst) {
        const dr = await prisma.driver.findFirst({ where: { userId: user.id }, select: { approvalStatus: true, approvedAt: true, rejectionReason: true, updatedAt: true, kyc: { select: { submittedAt: true } } } });
        if (dr && dr.kyc && dr.kyc.submittedAt) items.push({ id: 'drv-received', type: 'INFO', title: 'Documents received', body: 'Your documents were uploaded successfully and our team is verifying them. This takes up to 24 hours. We will notify you when it is done.', at: dr.kyc.submittedAt });
        if (dr && dr.approvalStatus === 'APPROVED') items.push({ id: 'drv-approved', type: 'INFO', title: 'You are approved to drive', body: 'Your documents were verified. Open Home, go online and start earning.', at: dr.approvedAt || dr.updatedAt });
        if (dr && dr.approvalStatus === 'REJECTED') items.push({ id: 'drv-rejected', type: 'INFO', title: 'Your application needs changes', body: dr.rejectionReason || 'Please open your application and fix what we asked for.', at: dr.updatedAt });
      }
    } catch (_) { /* optional */ }
    for (const t of trips) {
      const parcel = t.serviceType === 'PARCEL';
      if (t.status === 'COMPLETED') {
        items.push({ id: 'trip-' + t.id, type: 'TRIP', title: parcel ? 'Parcel delivered' : 'Trip completed', body: `${t.dropoffAddress} · MK ${Number(t.fareMWK || 0).toLocaleString()}`, at: t.updatedAt, tripId: t.id });
      } else if (t.status === 'CANCELLED_BY_DRIVER') {
        items.push({ id: 'trip-' + t.id, type: 'TRIP', title: 'Your captain cancelled', body: t.dropoffAddress, at: t.updatedAt, tripId: t.id });
      } else {
        items.push({ id: 'trip-' + t.id, type: 'TRIP', title: parcel ? 'Parcel request ended' : 'Trip cancelled', body: t.dropoffAddress, at: t.updatedAt, tripId: t.id });
      }
    }
    for (const k of tickets) {
      const last = (k.messages || [])[0];
      const staffReplied = last && last.authorRole !== 'RIDER' && last.authorRole !== 'DRIVER';
      items.push({ id: 'ticket-' + k.id, type: 'TICKET', title: staffReplied ? 'New reply from Aarohan support' : `Ticket ${String(k.status).toLowerCase().replace('_', ' ')}`, body: k.subject, at: staffReplied ? last.createdAt : k.updatedAt, ticketId: k.id });
    }
    items.push({ id: 'welcome', type: 'INFO', title: 'Welcome to Aarohan', body: 'Book a ride or send a parcel anywhere in Lilongwe.', at: user.createdAt });

    items.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ success: true, notifications: items.slice(0, 30) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/me/delete: delete the account (riders). Trip records stay, without personal details.
// ---------------------------------------------------------------------------
router.post('/me/delete', requireAuth, validateBody(z.object({ confirm: z.literal('DELETE') })), async (req, res) => {
  try {
    if (req.user.role !== 'RIDER') {
      return res.status(403).json({ error: 'Driver and staff accounts are removed by Aarohan support.' });
    }
    const active = await prisma.trip.findFirst({ where: { riderId: req.user.id, status: { in: ACTIVE_STATUSES } }, select: { id: true } });
    if (active) return res.status(409).json({ error: 'Finish or cancel your current trip before deleting your account.' });

    const id = req.user.id;
    await prisma.$transaction([
      prisma.emergencyContact.deleteMany({ where: { userId: id } }),
      prisma.savedPlace.deleteMany({ where: { userId: id } }),
      prisma.refreshToken.deleteMany({ where: { userId: id } }),
      prisma.user.update({
        where: { id },
        data: {
          name: 'Deleted user', email: null, phone: `deleted:${id}`, gender: null, dateOfBirth: null, avatarUrl: null,
          emergencyContactName: null, emergencyContactPhone: null, referralCode: null, status: 'DELETED'
        }
      }),
      prisma.auditLog.create({ data: { userId: id, action: 'ACCOUNT_DELETED', entityType: 'USER', entityId: id, details: {}, ipAddress: req.ip } })
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register this phone for push notifications (riders: captain accepted / arrived; drivers: ride offers, approval).
const deviceTokenSchema = z.object({ token: z.string().min(10).max(4096), platform: z.enum(['ANDROID', 'IOS', 'WEB']).optional().default('ANDROID') });
router.post('/me/device-token', requireAuth, validateBody(deviceTokenSchema), async (req, res) => {
  try {
    await require('../services/pushNotification').registerDeviceToken({ userId: req.user.id, token: req.body.token, platform: req.body.platform });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Could not register this phone for notifications.' }); }
});

module.exports = router;
