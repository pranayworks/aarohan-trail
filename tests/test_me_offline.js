'use strict';
// ============================================================================
// AAROHAN RIDER PROFILE SUITE (no database): /api/me routes and the live rider rating.
// Runs the real routes and middleware against a fake in-memory data layer.
// ============================================================================

const path = require('path');
const fs = require('fs');
const express = require('express');

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.OTP_HMAC_SECRET = 'test-otp-hmac-secret-16plus';
delete process.env.AUTH_MODE;

let passed = 0, total = 0;
function report(name, ok, detail = '') {
  total++;
  if (ok) { passed++; console.log(`✅ [PASS] ${name}`); }
  else console.log(`❌ [FAIL] ${name}${detail ? '  ::  ' + detail : ''}`);
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ------------------------------ fake data layer ------------------------------
const db = { users: [], contacts: [], places: [], trips: [], ratings: [], tickets: [], audit: [], tokens: 3 };
let seq = 0;
const mkUser = (o) => ({ id: 'U' + (++seq), name: 'Rider', email: null, gender: null, dateOfBirth: null, role: 'RIDER', status: 'ACTIVE',
  referralCode: null, referredById: null, emergencyContactName: null, emergencyContactPhone: null, createdAt: new Date('2026-01-01'), ...o });
const matchStatus = (s, w) => (w === undefined ? true : (typeof w === 'string' ? s === w : (w.in ? w.in.includes(s) : true)));

const prisma = {
  user: {
    findUnique: async ({ where, include }) => {
      const u = where.id ? db.users.find((x) => x.id === where.id) : where.referralCode ? db.users.find((x) => x.referralCode === where.referralCode) : null;
      if (!u) return null;
      const out = { ...u };
      if (include && include.emergencyContacts) out.emergencyContacts = db.contacts.filter((c) => c.userId === u.id).sort((a, b) => a.position - b.position);
      if (include && include.savedPlaces) out.savedPlaces = db.places.filter((p) => p.userId === u.id);
      if (include && include.driverProfile) out.driverProfile = null;
      return out;
    },
    findFirst: async ({ where }) => db.users.find((u) => (where.email ? u.email === where.email : true) && (!where.NOT || u.id !== where.NOT.id)) || null,
    update: async ({ where, data }) => { const u = db.users.find((x) => x.id === where.id); Object.assign(u, data); return { ...u }; },
    count: async ({ where }) => db.users.filter((u) => u.referredById === where.referredById).length,
    findMany: async ({ where }) => db.users.filter((u) => u.referredById === where.referredById).map((u) => ({
      id: u.id, name: u.name, createdAt: u.createdAt,
      tripsAsRider: db.trips.filter((t) => t.riderId === u.id && t.status === 'COMPLETED').slice(0, 1).map((t) => ({ id: t.id }))
    }))
  },
  emergencyContact: {
    deleteMany: async ({ where }) => { db.contacts = db.contacts.filter((c) => c.userId !== where.userId); return { count: 1 }; },
    create: async ({ data }) => { const c = { id: 'C' + (++seq), ...data }; db.contacts.push(c); return c; }
  },
  savedPlace: {
    findMany: async ({ where }) => db.places.filter((p) => p.userId === where.userId),
    create: async ({ data }) => { const p = { id: 'P' + (++seq), ...data }; db.places.push(p); return p; },
    deleteMany: async ({ where }) => {
      const ids = where.id && where.id.in ? where.id.in : where.id ? [where.id] : null;
      const before = db.places.length;
      db.places = db.places.filter((p) => !(p.userId === where.userId && (!ids || ids.includes(p.id))));
      return { count: before - db.places.length };
    }
  },
  trip: {
    findFirst: async ({ where }) => db.trips.find((t) => t.riderId === where.riderId && matchStatus(t.status, where.status)) || null,
    count: async ({ where }) => db.trips.filter((t) => t.riderId === where.riderId && matchStatus(t.status, where.status)).length,
    findMany: async ({ where }) => db.trips.filter((t) => t.riderId === where.riderId && matchStatus(t.status, where.status))
  },
  rating: { findMany: async ({ where }) => db.ratings.filter((r) => r.toUserId === where.toUserId) },
  supportTicket: { findMany: async ({ where }) => db.tickets.filter((t) => t.userId === where.userId) },
  auditLog: { create: async ({ data }) => { db.audit.push(data); return data; } },
  refreshToken: { deleteMany: async () => { db.tokens = 0; return { count: 3 }; } },
  $transaction: async (ops) => Promise.all(ops)
};
const prismaPath = require.resolve('../lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: prisma };

const authService = require('../services/auth');
const { scoreFrom } = require('../services/riderScore');
const meRouter = require('../routes/me');

(async function main() {
  console.log('=============================================================');
  console.log('   AAROHAN RIDER PROFILE SUITE (no database required)');
  console.log('=============================================================');

  console.log('\n--- 1. Rider rating is calculated live ---');
  report('A new rider with no ratings starts at 5.0', scoreFrom({ stars: [], trips: [] }).score === 5);
  report('The score starts from the average of the drivers\' stars', scoreFrom({ stars: [4, 5, 5, 4], trips: [] }).average === 4.5);
  const trips = (completed, late, early) => [
    ...Array(completed).fill({ status: 'COMPLETED', driverId: 'D1' }),
    ...Array(late).fill({ status: 'CANCELLED_BY_RIDER', driverId: 'D1' }),
    ...Array(early).fill({ status: 'CANCELLED_BY_RIDER', driverId: null })
  ];
  const lateCase = scoreFrom({ stars: [5, 5], trips: trips(8, 2, 0) });
  report('Cancelling after a captain was assigned lowers the score (2 of 10 trips: 5.0 to 4.2)', lateCase.score === 4.2 && lateCase.lateCancellations === 2, JSON.stringify(lateCase));
  const earlyCase = scoreFrom({ stars: [5, 5], trips: trips(8, 0, 2) });
  report('Cancelling before a captain was assigned costs much less (2 of 10: 5.0 to 4.8)', earlyCase.score === 4.8 && earlyCase.earlyCancellations === 2, JSON.stringify(earlyCase));
  report('The score never drops below 1.0 or goes above 5.0', scoreFrom({ stars: [1, 1], trips: trips(0, 10, 0) }).score >= 1 && scoreFrom({ stars: [5], trips: trips(10, 0, 0) }).score <= 5);
  report('Only the last 30 trips count', scoreFrom({ stars: [], trips: [...trips(30, 0, 0), ...trips(0, 20, 0)] }).lateCancellations === 0);

  // ------------------------------ HTTP layer ------------------------------
  const app = express();
  app.use(express.json());
  app.use('/api', meRouter);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const rider = mkUser({ phone: '+265991111111', name: 'Rita Banda', email: 'rita@example.com' });
  const friend = mkUser({ phone: '+265992222222', name: 'Friend', referralCode: 'ARFRIEND', email: 'friend@example.com' });
  const driverUser = mkUser({ phone: '+265993333333', role: 'DRIVER' });
  db.users.push(rider, friend, driverUser);
  const tok = (u) => authService.issueAccessToken({ ...u, driverProfile: null });
  const call = async (method, p, body, user = rider) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: 'Bearer ' + tok(user) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = {}; try { json = await res.json(); } catch (_) {}
    return { status: res.status, body: json };
  };

  console.log('\n--- 2. Access control ---');
  report('Every profile route needs a login', (await call('GET', '/me', null, null)).status === 401 && (await call('GET', '/me/rewards', null, null)).status === 401 && (await call('POST', '/me/delete', { confirm: 'DELETE' }, null)).status === 401);

  console.log('\n--- 3. Profile ---');
  db.ratings.push({ toUserId: rider.id, stars: 5 }, { toUserId: rider.id, stars: 4 });
  db.trips.push({ id: 'T1', riderId: rider.id, status: 'COMPLETED', driverId: 'D1', serviceType: 'RIDE', dropoffAddress: 'Area 3', fareMWK: 3000, completedAt: new Date('2026-02-01'), updatedAt: new Date('2026-02-01') });
  const me1 = await call('GET', '/me');
  const prof = me1.body.profile || {};
  report('GET /me returns details, live rating, member-since and counts', me1.status === 200 && prof.name === 'Rita Banda' && prof.rating.score === 4.5 && !!prof.memberSince && prof.completedTrips === 1);
  report('A referral code is created on first use', /^AR[A-HJKMNP-Z2-9]{6}$/.test(prof.referralCode || ''), prof.referralCode);
  const again = await call('GET', '/me');
  report('The referral code stays the same afterwards', again.body.profile.referralCode === prof.referralCode);

  report('Under-18s are refused', (await call('PATCH', '/me', { dateOfBirth: new Date(Date.now() - 10 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10) })).status === 400);
  const okPatch = await call('PATCH', '/me', { name: 'Rita B', gender: 'FEMALE', dateOfBirth: '1996-04-23' });
  report('Name, gender and date of birth are saved', okPatch.status === 200 && rider.name === 'Rita B' && rider.gender === 'FEMALE' && rider.dateOfBirth.toISOString().startsWith('1996-04-23'));
  report('An unknown gender value is refused', (await call('PATCH', '/me', { gender: 'robot' })).status === 400);
  report('Someone else\'s email cannot be taken', (await call('PATCH', '/me', { email: 'friend@example.com' })).status === 409);
  const noEmail = mkUser({ phone: '+265994444444', name: 'New Person' });
  db.users.push(noEmail);
  report('An email already used by another account is refused', (await call('PATCH', '/me', { email: 'friend@example.com' }, noEmail)).status === 409);
  report('A new email is saved when the account has none', (await call('PATCH', '/me', { email: 'new.person@example.com' }, noEmail)).status === 200 && noEmail.email === 'new.person@example.com');
  process.env.AUTH_MODE = 'email';
  report('In email mode the sign-in email cannot be changed here', (await call('PATCH', '/me', { email: 'other@example.com' })).status === 400);
  delete process.env.AUTH_MODE;
  report('A referral code links the new rider to the friend', (await call('PATCH', '/me', { referralCode: 'arfriend' }, noEmail)).status === 200 && noEmail.referredById === friend.id);
  report('You cannot use your own referral code', (await call('PATCH', '/me', { referralCode: 'ARFRIEND' }, friend)).status === 400);
  report('An unknown referral code is refused', (await call('PATCH', '/me', { referralCode: 'ZZZZZZ9' }, mkUserRegister())).status === 400);
  function mkUserRegister() { const u = mkUser({ phone: '+265995555555' }); db.users.push(u); return u; }
  report('Profile changes are audited without storing the values', db.audit.some((a) => a.action === 'PROFILE_UPDATED' && Array.isArray(a.details.fields) && !JSON.stringify(a.details).includes('1996')));

  console.log('\n--- 4. Emergency contacts (up to 3) ---');
  const four = Array.from({ length: 4 }, (_, i) => ({ name: 'Contact ' + i, phone: '09911000' + (10 + i) }));
  report('More than 3 contacts are refused', (await call('PUT', '/me/emergency-contacts', { contacts: four })).status === 400);
  report('A bad phone number is refused', (await call('PUT', '/me/emergency-contacts', { contacts: [{ name: 'Mum', phone: '12345678' }] })).status === 400);
  report('Your own number is refused', (await call('PUT', '/me/emergency-contacts', { contacts: [{ name: 'Me', phone: '+265991111111' }] })).status === 400);
  report('The same number twice is refused', (await call('PUT', '/me/emergency-contacts', { contacts: [{ name: 'A B', phone: '0998877665' }, { name: 'C D', phone: '+265998877665' }] })).status === 400);
  const saved = await call('PUT', '/me/emergency-contacts', { contacts: [{ name: 'Mum Banda', phone: '0998877665', relation: 'Mother' }, { name: 'Tom Banda', phone: '0888111222' }] });
  report('Valid contacts are saved with normalised numbers', saved.status === 200 && db.contacts.length === 2 && db.contacts[0].phone === '+265998877665');
  report('The first contact is also kept where SOS reads it', rider.emergencyContactName === 'Mum Banda' && rider.emergencyContactPhone === '+265998877665');
  await call('PUT', '/me/emergency-contacts', { contacts: [] });
  report('An empty list clears the contacts', db.contacts.length === 0 && rider.emergencyContactPhone === null);

  console.log('\n--- 5. Saved places ---');
  const home1 = await call('POST', '/me/places', { label: 'Home', name: 'Area 47', lat: -13.96, lng: 33.77 });
  await call('POST', '/me/places', { label: 'Home', name: 'Area 3', lat: -13.97, lng: 33.78 });
  report('Home can only exist once (the newer one replaces it)', home1.status === 201 && db.places.filter((p) => p.userId === rider.id && p.label === 'Home').length === 1 && db.places.find((p) => p.label === 'Home').name === 'Area 3');
  report('Coordinates must be real', (await call('POST', '/me/places', { label: 'Work', name: 'X', lat: 999, lng: 33 })).status === 400);
  const other = await call('POST', '/me/places', { label: 'Gym', name: 'Gym', lat: -13.9, lng: 33.7 });
  report('Nobody can delete someone else\'s place', (await call('DELETE', '/me/places/' + other.body.place.id, null, friend)).status === 404);
  report('You can delete your own place', (await call('DELETE', '/me/places/' + other.body.place.id)).status === 200);

  console.log('\n--- 6. Rewards, notifications, delete ---');
  db.trips.push({ id: 'T2', riderId: noEmail.id, status: 'COMPLETED' });
  const fr = await call('GET', '/me/rewards', null, friend);
  db.trips.push({ id: 'T3', riderId: rider.id, status: 'COMPLETED', serviceType: 'PARCEL', dropoffAddress: 'Kanengo', completedAt: new Date('2026-03-01') });
  const rw = await call('GET', '/me/rewards');
  report('Coins come from completed trips (10 each) and friends\' first trips (50 each)', rw.body.coins === 20 && rw.body.perTrip === 10 && rw.body.redeemable === false && fr.body.coins === 50 && fr.body.qualifiedReferrals === 1, JSON.stringify({ rw: rw.body.coins, fr: fr.body.coins }));
  const nt = await call('GET', '/me/notifications');
  report('Notifications are built from the rider\'s own trips and always include a welcome', nt.status === 200 && nt.body.notifications.some((n) => n.id === 'welcome') && nt.body.notifications.some((n) => n.title === 'Trip completed'));
  report('Deleting needs the word DELETE', (await call('POST', '/me/delete', { confirm: 'yes' })).status === 400);
  report('Drivers cannot delete themselves here', (await call('POST', '/me/delete', { confirm: 'DELETE' }, driverUser)).status === 403);
  db.trips.push({ id: 'T4', riderId: rider.id, status: 'IN_TRANSIT' });
  report('A rider on an active trip cannot delete', (await call('POST', '/me/delete', { confirm: 'DELETE' })).status === 409);
  db.trips = db.trips.filter((t) => t.id !== 'T4');
  const del = await call('POST', '/me/delete', { confirm: 'DELETE' });
  report('Deleting removes personal details and signs the person out everywhere',
    del.status === 200 && rider.status === 'DELETED' && rider.email === null && rider.name === 'Deleted user' && rider.phone.startsWith('deleted:') && rider.dateOfBirth === null && db.tokens === 0);
  report('The deletion is audited', db.audit.some((a) => a.action === 'ACCOUNT_DELETED'));

  console.log('\n--- 7. Database changes ---');
  const mig = read('prisma/migrations/20261109_rider_profile/migration.sql') + read('prisma/migrations/20261109_enum_values/migration.sql');
  report('Migrations only add things (no drops, renames or type changes)', !/DROP |RENAME|ALTER COLUMN/i.test(mig) && /ADD VALUE IF NOT EXISTS 'DELETED'/.test(mig));
  report('New tables are locked down (row level security)', /"EmergencyContact" ENABLE ROW LEVEL SECURITY/.test(mig) && /"SavedPlace" ENABLE ROW LEVEL SECURITY/.test(mig));
  const schema = read('prisma/schema.prisma');
  report('The Prisma schema matches the migrations', ['model EmergencyContact', 'model SavedPlace', 'referralCode', 'weightKg', 'payer', 'DELETED', 'ACCOUNT_DELETED'].every((w) => schema.includes(w)));
  const th = read('sockets/tripHandlers.js');
  report('Parcels record weight and who pays, and must fit the vehicle', th.includes('weightKg') && th.includes("RECEIVER_AT_DELIVERY") && /too heavy for a/.test(th));
  report('SOS texts every emergency contact', read('services/notifications.js').includes('contactPhones') && read('services/sos.js').includes('emergencyContacts'));
  const mig2 = read('prisma/migrations/20261109_pickup_note/migration.sql');
  report('Pickup note and call-on-arrival are saved with the trip (additive migration, schema, booking handler)', /ADD COLUMN IF NOT EXISTS "pickupNote"/.test(mig2) && !/DROP |RENAME/i.test(mig2) && schema.includes('pickupNote') && schema.includes('callOnArrival') && th.includes('pickupNote') && read('shared/state.js').includes('pickupNote'));
  report('Fair-price promise: the server ignores client surge unless SURGE_ENABLED=true', /process\.env\.SURGE_ENABLED === 'true' && surgeMultiplier/.test(read('routes/rides.js')));
  report('The routes are mounted', read('server.js').includes("app.use('/api', meRouter)"));

  server.close();
  console.log('\n=============================================================');
  console.log(`   RIDER PROFILE RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('=============================================================');
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('Suite crashed:', e); process.exit(1); });
