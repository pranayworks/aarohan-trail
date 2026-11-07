'use strict';
// ============================================================================
// AAROHAN OFFLINE SAFETY SUITE (no database, no network)
// ----------------------------------------------------------------------------
// Runs the REAL socket handlers, emitters, settlement rules, storage guard and
// production config validator against a fake in-memory data layer and a real
// Socket.IO server. It proves privacy/safety rules that database tests cannot:
//   - no broadcasts: strangers never receive trips, chat, SOS, locations
//   - the safety PIN reaches the rider only
//   - SOS identity/contacts come from the database, never the client
//   - settlements are atomic, single-use and balanced
//   - production never stores ID documents on disk
// ============================================================================

const path = require('path');
const fs = require('fs');
const http = require('http');

let passed = 0;
let total = 0;
function report(name, ok, detail = '') {
  total++;
  if (ok) { passed++; console.log(`✅ [PASS] ${name}`); }
  else { console.log(`❌ [FAIL] ${name}${detail ? '  ::  ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ----------------------------------------------------------------------------
// Fake data layer injected BEFORE any module requires lib/prisma
// ----------------------------------------------------------------------------
const db = {
  users: {
    'U-RIDER': { id: 'U-RIDER', name: 'Rita Rider', phone: '+265991111111', emergencyContactName: 'Mum', emergencyContactPhone: '+265881111111' },
    'U-DRIVER': { id: 'U-DRIVER', name: 'Dan Driver', phone: '+265992222222', emergencyContactName: null, emergencyContactPhone: null },
    'U-OTHER': { id: 'U-OTHER', name: 'Olu Other', phone: '+265993333333', emergencyContactName: null, emergencyContactPhone: null }
  },
  trips: {
    T1: { id: 'T1', status: 'DRIVER_ARRIVING', riderId: 'U-RIDER', driverId: 'D1', pickupLat: -13.97, pickupLng: 33.78, driver: { userId: 'U-DRIVER', user: { name: 'Dan Driver', phone: '+265992222222' } }, rider: { name: 'Rita Rider', phone: '+265991111111' } },
    T2: { id: 'T2', status: 'REQUESTED', riderId: 'U-RIDER', driverId: null, pickupLat: -13.97, pickupLng: 33.78, driver: null, rider: { name: 'Rita Rider', phone: '+265991111111' } },
    T3: { id: 'T3', status: 'IN_TRANSIT', riderId: 'U-OTHER', driverId: 'D9', pickupLat: -13.95, pickupLng: 33.77, driver: { userId: 'U-OTHERDRIVER', user: { name: 'Other Driver', phone: '+265994444444' } }, rider: { name: 'Olu Other', phone: '+265993333333' } }
  },
  chat: [], sos: [], audit: [], sosAlerts: [],
  drivers: { D1: { id: 'D1', userId: 'U-DRIVER', commissionDebtMWK: 10000, user: { id: 'U-DRIVER' } } },
  remittances: [], ledger: []
};
const owns = (OR, t) => (OR || []).some((o) => (o.riderId && o.riderId === t.riderId) || (o.driverId && o.driverId === t.driverId));
const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : o);

const fakePrisma = {
  trip: {
    findUnique: async ({ where }) => clone(db.trips[where.id]) || null,
    findFirst: async ({ where }) => {
      const t = db.trips[where.id];
      if (!t) return null;
      if (where.OR && !owns(where.OR, t)) return null;
      return clone(t);
    },
    findMany: async ({ where }) => Object.values(db.trips)
      .filter((t) => owns(where.OR, t) && where.status.in.includes(t.status)).map((t) => ({ id: t.id }))
  },
  user: { findUnique: async ({ where }) => clone(db.users[where.id]) || null },
  chatMessage: { create: async ({ data }) => { db.chat.push(data); return data; } },
  sosEvent: {
    findFirst: async ({ where }) => {
      const rows = db.sos.filter((r) => r.userId === where.userId && r.status === where.status && r.createdAt >= where.createdAt.gte);
      return rows[rows.length - 1] || null;
    },
    create: async ({ data }) => { const row = { id: 'SOS' + (db.sos.length + 1), createdAt: new Date(), ...data }; db.sos.push(row); return row; },
    updateMany: async ({ where, data }) => {
      const row = db.sos.find((r) => r.id === where.id && where.status.in.includes(r.status));
      if (!row) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    }
  },
  auditLog: { create: async ({ data }) => { db.audit.push(data); return data; } },
  driver: {
    findUnique: async ({ where }) => (db.drivers[where.id] ? { ...db.drivers[where.id] } : null),
    update: async ({ where, data }) => { Object.assign(db.drivers[where.id], data); return { ...db.drivers[where.id] }; }
  },
  ledgerEntry: { create: async ({ data }) => { db.ledger.push(data); return data; } },
  commissionRemittance: {
    aggregate: async ({ where }) => ({ _sum: { amountMWK: db.remittances.filter((r) => r.driverId === where.driverId && r.status === where.status).reduce((a, r) => a + r.amountMWK, 0) || null } }),
    create: async ({ data }) => {
      if (db.remittances.some((r) => r.status !== 'REJECTED' && r.reference.toLowerCase() === data.reference.toLowerCase())) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = { id: 'R' + (db.remittances.length + 1), status: 'PENDING_VERIFICATION', submittedAt: new Date(), reviewedBy: null, reviewedAt: null, reviewNotes: null, journalId: null, notes: null, ...data };
      db.remittances.push(row); return { ...row };
    },
    findUnique: async ({ where }) => { const r = db.remittances.find((x) => x.id === where.id); return r ? { ...r } : null; },
    updateMany: async ({ where, data }) => {
      const r = db.remittances.find((x) => x.id === where.id && x.status === where.status);
      if (!r) return { count: 0 };
      Object.assign(r, data); return { count: 1 };
    },
    update: async ({ where, data }) => { const r = db.remittances.find((x) => x.id === where.id); Object.assign(r, data); return { ...r }; }
  },
  $transaction: async (fn) => fn(fakePrisma)
};
const prismaPath = require.resolve('../lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: fakePrisma };

// Real modules under test (loaded AFTER the fake data layer is in place)
const featureFlags = require('../services/featureFlags');
const { validateStartupConfig } = require('../services/configValidator');
const emitters = require('../sockets/emitters');
const { joinUserRooms } = require('../sockets/rooms');
const registerChatHandlers = require('../sockets/chatHandlers');
const notificationService = require('../services/notifications');
const settlementService = require('../services/settlements');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');

notificationService.sendEmergencySosAlert = async (alert) => { db.sosAlerts.push(alert); return {}; };

function connect(port, auth) {
  return new Promise((resolve, reject) => {
    const c = ioClient(`http://127.0.0.1:${port}`, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    c.on('connect', () => resolve(c));
    c.on('connect_error', reject);
  });
}
function listen(client, events) {
  const log = [];
  for (const ev of events) client.on(ev, (payload) => log.push({ ev, payload }));
  return log;
}
const ack = (client, event, payload) => new Promise((resolve) => client.emit(event, payload, resolve));
const count = (log, ev) => log.filter((e) => e.ev === ev).length;

(async function main() {
  console.log('=============================================================');
  console.log('   AAROHAN OFFLINE SAFETY SUITE (no database required)');
  console.log('=============================================================');

  // --------------------------------------------------------------------------
  console.log('\n--- 1. Feature flags: cash-only pilot ---');
  const prodEnv = { NODE_ENV: 'production' };
  report('Payments are OFF in production by default', featureFlags.paymentsEnabled(prodEnv) === false);
  report('Payouts are OFF in production by default', featureFlags.payoutsEnabled(prodEnv) === false);
  report('Payments can be enabled explicitly in production', featureFlags.paymentsEnabled({ NODE_ENV: 'production', PAYMENTS_ENABLED: 'true' }) === true);
  report('Payments and payouts stay available in development', featureFlags.paymentsEnabled({ NODE_ENV: 'development' }) && featureFlags.payoutsEnabled({}) === true);

  // --------------------------------------------------------------------------
  console.log('\n--- 2. Production config validator ---');
  const validProd = {
    NODE_ENV: 'production',
    JWT_SECRET: 'aarohan-super-strong-production-jwt-secret-key-64-bytes-long-ok',
    OTP_HMAC_SECRET: 'aarohan-otp-hmac-production-key-32-bytes-ok',
    DATABASE_URL: 'postgresql://postgres:securepass@db.supabase.co:5432/aarohan',
    SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super-long-valid-supabase-service-key',
    AAROHAN_SECURITY_DESK_PHONE: '+265881234567'
  };
  const expectThrow = (env, needle) => { try { validateStartupConfig(env, true); return false; } catch (e) { return e.message.includes(needle); } };
  report('Valid production config passes', validateStartupConfig(validProd, true).valid === true);
  report('Production refuses to start without a security desk number', expectThrow({ ...validProd, AAROHAN_SECURITY_DESK_PHONE: '' }, 'AAROHAN_SECURITY_DESK_PHONE'));
  report('Production refuses the demo rider number as security desk', expectThrow({ ...validProd, AAROHAN_SECURITY_DESK_PHONE: '+265991234567' }, 'demo rider'));
  report('Production refuses DATABASE_URL_TEST', expectThrow({ ...validProd, DATABASE_URL_TEST: 'postgresql://x' }, 'DATABASE_URL_TEST'));
  report('Production refuses TEST_DB_PROJECT_REF', expectThrow({ ...validProd, TEST_DB_PROJECT_REF: 'abc' }, 'TEST_DB_PROJECT_REF'));

  // --------------------------------------------------------------------------
  console.log('\n--- 3. ID documents never touch the server disk in production ---');
  const keep = { n: process.env.NODE_ENV, u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SECRET_KEY, s: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.NODE_ENV = 'production';
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const storage = require('../services/supabaseStorage');
  let storageError = null;
  try {
    await storage.uploadDriverDocument({ driverId: 'D-OFFLINE-TEST', documentType: 'DRIVING_LICENSE', file: { buffer: Buffer.from('abc'), size: 3, mimetype: 'image/jpeg', originalname: 'x.jpg' } });
  } catch (e) { storageError = e; }
  report('Production upload fails safely when cloud storage is unavailable', !!storageError && /temporarily unavailable/i.test(storageError.message));
  report('Nothing was written to the local uploads folder', !fs.existsSync(path.join(storage.LOCAL_STORAGE_DIR, 'D-OFFLINE-TEST')));
  report('No local download link is produced in production', (await storage.getSignedUrl('D-OFFLINE-TEST/x.jpg')) === null);
  for (const [k, v] of [['NODE_ENV', keep.n], ['SUPABASE_URL', keep.u], ['SUPABASE_SECRET_KEY', keep.k], ['SUPABASE_SERVICE_ROLE_KEY', keep.s]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }

  // --------------------------------------------------------------------------
  console.log('\n--- 4. Realtime privacy: real Socket.IO server, real handlers ---');
  const httpServer = http.createServer();
  const io = new Server(httpServer);
  io.use((socket, next) => {
    const a = socket.handshake.auth || {};
    socket.userId = a.userId; socket.userRole = a.role; socket.driverId = a.driverId || null; next();
  });
  io.on('connection', (socket) => { joinUserRooms(socket, fakePrisma); registerChatHandlers(io, socket, {}); });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const port = httpServer.address().port;

  const EVENTS = ['trip:accepted', 'trip:requested', 'chat:message', 'sos:alert', 'sos:resolved', 'call:signal', 'trip:driver_moved'];
  const rider = await connect(port, { userId: 'U-RIDER', role: 'RIDER' });
  const driver = await connect(port, { userId: 'U-DRIVER', role: 'DRIVER', driverId: 'D1' });
  const other = await connect(port, { userId: 'U-OTHER', role: 'RIDER' });
  const admin = await connect(port, { userId: 'U-ADMIN', role: 'ADMIN' });
  const logs = { rider: listen(rider, EVENTS), driver: listen(driver, EVENTS), other: listen(other, EVENTS), admin: listen(admin, EVENTS) };
  await sleep(150);

  const secretTrip = {
    id: 'T1', riderId: 'U-RIDER', pin: '4321', deliveryCode: '9988', status: 'DRIVER_ARRIVING',
    rider: { id: 'U-RIDER', name: 'Rita Rider', phone: '+265991111111', emergencyContactPhone: '+265881111111', passwordHash: 'x' },
    driver: { id: 'D1', userId: 'U-DRIVER', rating: 4.9, ratingCount: 10, tripsCompleted: 50, commissionDebtMWK: 9999, currentLat: -13.9, currentLng: 33.7,
      user: { id: 'U-DRIVER', name: 'Dan Driver', phone: '+265992222222', email: 'dan@x.mw', passwordHash: 'y' },
      vehicle: { type: 'CAB', makeModel: 'Passo', color: 'White', plateNumber: 'BW 4920', year: 2015, secretField: 'z' } }
  };
  emitters.emitTripEvent(io, 'trip:accepted', secretTrip, (t) => ({ trip: t, driver: t.driver }));
  await sleep(200);

  const riderGot = logs.rider.find((e) => e.ev === 'trip:accepted');
  const driverGot = logs.driver.find((e) => e.ev === 'trip:accepted');
  const adminGot = logs.admin.find((e) => e.ev === 'trip:accepted');
  report('Rider receives the trip INCLUDING the safety PIN', riderGot?.payload.trip.pin === '4321');
  report('Driver receives the trip WITHOUT the safety PIN', !!driverGot && driverGot.payload.trip.pin === undefined && !JSON.stringify(driverGot.payload).includes('4321'));
  report('Driver never receives the parcel delivery code', !!driverGot && !JSON.stringify(driverGot.payload).includes('9988'));
  report('Ops staff receive the trip WITHOUT the PIN', !!adminGot && adminGot.payload.trip.pin === undefined);
  report('A stranger (another rider) receives NOTHING', logs.other.length === 0);
  report('Rider payload hides the driver commission debt and credentials',
    !JSON.stringify(riderGot.payload).includes('9999') && !JSON.stringify(riderGot.payload).includes('passwordHash') && !JSON.stringify(riderGot.payload).includes('dan@x.mw'));
  report('Driver payload hides the rider emergency contact and credentials',
    !JSON.stringify(driverGot.payload).includes('881111111') && !JSON.stringify(driverGot.payload).includes('passwordHash'));
  report('Plate and driver name still reach the rider', riderGot.payload.driver.vehicle.plateNumber === 'BW 4920' && riderGot.payload.driver.user.name === 'Dan Driver');

  // Chat
  const msgOk = await ack(driver, 'chat:send', { tripId: 'T1', text: 'I am outside' });
  await sleep(150);
  report('Driver can chat on their active trip', msgOk.success === true);
  report('Rider receives the chat message', count(logs.rider, 'chat:message') === 1);
  report('Stranger and ops do NOT receive chat messages', count(logs.other, 'chat:message') === 0 && count(logs.admin, 'chat:message') === 0);
  const strangerChat = await ack(other, 'chat:send', { tripId: 'T1', text: 'spam' });
  report('A stranger cannot post into someone else\'s trip chat', strangerChat.success === false && /not part of this trip/i.test(strangerChat.error));
  const noDriverChat = await ack(rider, 'chat:send', { tripId: 'T2', text: 'hello?' });
  report('Chat is refused before a driver is assigned', noDriverChat.success === false);
  const longChat = await ack(rider, 'chat:send', { tripId: 'T1', text: 'x'.repeat(1500) });
  report('Very long messages are cut to 1000 characters', longChat.success === true && longChat.message.text.length === 1000);

  // Call signalling
  rider.emit('call:signal', { tripId: 'T1', data: { sdp: 'offer' } });
  other.emit('call:signal', { tripId: 'T1', data: { sdp: 'evil' } });
  await sleep(250);
  report('Call signal reaches only the other party on the trip', count(logs.driver, 'call:signal') === 1 && count(logs.other, 'call:signal') === 0 && count(logs.admin, 'call:signal') === 0);

  // SOS
  const sos = await ack(rider, 'sos:trigger', { tripId: 'T1', lat: 95, lng: 33.8, emergencyPhone: '+265999999999', riderPhone: '+265000000000', passenger: 'Fake Name', note: 'help' });
  await sleep(200);
  const alert = db.sosAlerts[0];
  report('SOS succeeds and is stored', sos.success === true && db.sos.length === 1);
  report('SOS contact comes from the DATABASE, not the client', !!alert && alert.emergencyPhone === '+265881111111' && alert.riderPhone === '+265991111111' && alert.passenger === 'Rita Rider');
  report('Out-of-range GPS falls back to the trip pickup and is flagged approximate', !!alert && alert.locationApproximate === true && alert.lat === -13.97);
  report('SOS alert goes to ops staff only', count(logs.admin, 'sos:alert') === 1 && count(logs.other, 'sos:alert') === 0 && count(logs.driver, 'sos:alert') === 0);
  const sos2 = await ack(rider, 'sos:trigger', { tripId: 'T1', lat: -13.9, lng: 33.8 });
  await sleep(100);
  report('A repeated press within a minute returns the same incident', sos2.duplicate === true && db.sos.length === 1 && count(logs.admin, 'sos:alert') === 1);
  const sosForeign = await ack(driver, 'sos:trigger', { tripId: 'T3', lat: -13.9, lng: 33.8 });
  report('SOS cannot be attached to a trip the caller is not part of', sosForeign.success === true && db.sos[db.sos.length - 1].tripId === null);
  report('SOS writes an audit record', db.audit.filter((a) => a.action === 'SOS_TRIGGERED').length >= 2);
  const riderResolve = await ack(rider, 'sos:resolve', 'SOS1');
  report('A rider cannot resolve SOS incidents', riderResolve.success === false);
  const adminResolve = await ack(admin, 'sos:resolve', 'SOS1');
  await sleep(100);
  report('Ops staff can resolve an incident (and only ops are told)', adminResolve.success === true && count(logs.admin, 'sos:resolved') === 1 && count(logs.other, 'sos:resolved') === 0);

  [rider, driver, other, admin].forEach((c) => c.disconnect());
  io.close(); httpServer.close();

  // --------------------------------------------------------------------------
  console.log('\n--- 4b. SOS over HTTP (backup when the live connection is down) ---');
  const { handleSosRequest } = require('../services/sos');
  const opsEvents = [];
  const fakeIo = { to: (room) => ({ emit: (ev, payload) => opsEvents.push({ room, ev, payload }) }) };
  const callHttp = async (user, body) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await handleSosRequest({ user, body, app: { get: () => fakeIo } }, res);
    return res;
  };
  const alertsBefore = db.sosAlerts.length;
  const http1 = await callHttp({ id: 'U-OTHER', role: 'RIDER', driverId: null }, { lat: -13.95, lng: 33.77, emergencyPhone: '+265000000001', riderPhone: '+265000000002', note: 'no signal' });
  await sleep(100);
  report('HTTP SOS is accepted and stored', http1.statusCode === 201 && http1.body.success === true && !!http1.body.alert.id);
  report('HTTP SOS identity and contacts come from the DATABASE, not the request',
    http1.body.alert.riderPhone === '+265993333333' && http1.body.alert.passenger === 'Olu Other' && http1.body.alert.emergencyPhone === null);
  report('HTTP SOS alerts operations staff only', opsEvents.length === 1 && opsEvents[0].room === 'ops' && opsEvents[0].ev === 'sos:alert');
  report('HTTP SOS triggers the SMS escalation', db.sosAlerts.length === alertsBefore + 1);
  const http2 = await callHttp({ id: 'U-OTHER', role: 'RIDER', driverId: null }, { lat: -13.95, lng: 33.77 });
  report('A repeated HTTP press returns the same incident without a second alert',
    http2.statusCode === 200 && http2.body.duplicate === true && opsEvents.length === 1 && db.sosAlerts.length === alertsBefore + 1);
  const http3 = await callHttp({ id: 'U-DRIVER', role: 'DRIVER', driverId: 'D1' }, { lat: 'not-a-number' });
  report('Invalid HTTP SOS input is rejected', http3.statusCode === 400 && http3.body.success === false);
  report('The HTTP SOS route requires a login and is mounted',
    /router\.post\('\/sos', requireAuth, handleSosRequest\)/.test(read('routes/sos.js')) && read('server.js').includes("app.use('/api', sosRouter)"));
  report('The phone apps fall back to the HTTP route when the socket is down or unconfirmed',
    read('shared/state.js').includes("'/api/sos'") && /viaHttp\(payload\)\.then\(finish\)/.test(read('shared/state.js')));

  // --------------------------------------------------------------------------
  console.log('\n--- 5. Commission settlement rules (single-use, balanced, atomic) ---');
  const codeOf = async (p) => { try { await p; return 'OK'; } catch (e) { return e.code || e.message; } };
  const badAmounts = await Promise.all([0, -5, 12.5, 'abc'].map((a) => codeOf(settlementService.submit({ driverId: 'D1', amountMWK: a, method: 'AIRTEL_MONEY', reference: 'REF-12345' }))));
  report('Rejects zero, negative, decimal and non-numeric amounts', badAmounts.every((c) => c === 'INVALID_AMOUNT'), badAmounts.join(','));
  report('Rejects a missing or too-short payment reference', (await codeOf(settlementService.submit({ driverId: 'D1', amountMWK: 1000, method: 'AIRTEL_MONEY', reference: 'x' }))) === 'INVALID_REFERENCE');
  report('Rejects paying more than the outstanding debt', (await codeOf(settlementService.submit({ driverId: 'D1', amountMWK: 10001, method: 'AIRTEL_MONEY', reference: 'REF-TOO-BIG' }))) === 'EXCEEDS_DEBT');
  const s1 = await settlementService.submit({ driverId: 'D1', amountMWK: 7500, method: 'airtel money', reference: 'AM-REF-0001' });
  report('A valid submission is stored as PENDING_VERIFICATION', s1.status === 'PENDING_VERIFICATION' && s1.amount === 7500 && s1.remittanceMethod === 'AIRTEL_MONEY');
  report('Pending amounts count against what can still be settled', (await codeOf(settlementService.submit({ driverId: 'D1', amountMWK: 3000, method: 'AIRTEL_MONEY', reference: 'AM-REF-0002' }))) === 'EXCEEDS_DEBT');
  report('The same payment reference cannot be used twice', (await codeOf(settlementService.submit({ driverId: 'D1', amountMWK: 1000, method: 'AIRTEL_MONEY', reference: 'am-ref-0001' }))) === 'DUPLICATE_REFERENCE');

  const approved = await settlementService.approve({ settlementId: s1.settlementId, adminUserId: 'U-ADMIN', notes: 'Checked Airtel portal' });
  const legs = db.ledger.filter((l) => l.journalId === approved.ledgerResult.journalId);
  report('Approval reduces the driver debt by exactly the amount', db.drivers.D1.commissionDebtMWK === 2500 && approved.ledgerResult.newDebtMWK === 2500);
  report('Approval writes a balanced two-leg ledger journal (net zero)', legs.length === 2 && legs.reduce((a, l) => a + l.amountMWK, 0) === 0);
  report('Approval marks the remittance VERIFIED and links the journal', approved.remittance.status === 'VERIFIED' && approved.remittance.journalId === approved.ledgerResult.journalId);
  report('A second approval is refused (debt cannot be reduced twice)', (await codeOf(settlementService.approve({ settlementId: s1.settlementId, adminUserId: 'U-ADMIN' }))) === 'ALREADY_PROCESSED' && db.drivers.D1.commissionDebtMWK === 2500);
  report('Approving an unknown settlement returns NOT_FOUND', (await codeOf(settlementService.approve({ settlementId: 'nope', adminUserId: 'U-ADMIN' }))) === 'NOT_FOUND');

  const s2 = await settlementService.submit({ driverId: 'D1', amountMWK: 1000, method: 'TNM_MPAMBA', reference: 'TNM-REF-7777' });
  const racers = await Promise.all([1, 2, 3].map(() => codeOf(settlementService.approve({ settlementId: s2.settlementId, adminUserId: 'U-ADMIN' }))));
  report('Concurrent approvals: exactly one wins and the debt is reduced once', racers.filter((r) => r === 'OK').length === 1 && db.drivers.D1.commissionDebtMWK === 1500, racers.join(','));

  const s3 = await settlementService.submit({ driverId: 'D1', amountMWK: 500, method: 'TNM_MPAMBA', reference: 'TNM-REF-8888' });
  report('Rejection requires a reason', (await codeOf(settlementService.reject({ settlementId: s3.settlementId, adminUserId: 'U-ADMIN', reason: ' ' }))) === 'REASON_REQUIRED');
  const rejected = await settlementService.reject({ settlementId: s3.settlementId, adminUserId: 'U-ADMIN', reason: 'Reference not found' });
  report('Rejection is recorded and audit-logged; the debt is unchanged', rejected.status === 'REJECTED' && db.drivers.D1.commissionDebtMWK === 1500 && db.audit.some((a) => a.entityType === 'COMMISSION_SETTLEMENT' && a.details.decision === 'REJECTED'));
  report('A verified settlement can never be rejected', (await codeOf(settlementService.reject({ settlementId: s1.settlementId, adminUserId: 'U-ADMIN', reason: 'oops' }))) === 'ALREADY_PROCESSED');
  report('A rejected reference can be resubmitted', (await codeOf(settlementService.submit({ driverId: 'D1', amountMWK: 500, method: 'TNM_MPAMBA', reference: 'TNM-REF-8888' }))) === 'OK');

  // --------------------------------------------------------------------------
  console.log('\n--- 6. Source guards (prevent these bugs from coming back) ---');
  const listJs = (dir) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`);
  const serverFiles = [...listJs('sockets'), ...listJs('routes'), ...listJs('services'), 'server.js'].filter((f) => f !== 'sockets/emitters.js');
  const ALLOWED_BROADCASTS = ['pricing:rates_updated', 'pricing:version_activated', 'pricing:global_updated', 'surge:updated'];
  const offenders = [];
  for (const f of serverFiles) {
    const src = read(f);
    for (const m of src.matchAll(/(?:\bio\.emit|this\.io\.emit|req\.app\.get\('io'\)\.emit|socket\.broadcast\.emit)\(\s*'([^']+)'/g)) {
      if (!ALLOWED_BROADCASTS.includes(m[1])) offenders.push(`${f}: ${m[1]}`);
    }
  }
  report('No server code broadcasts private events to every connected user', offenders.length === 0, offenders.join(' | '));
  const th = read('sockets/tripHandlers.js');
  report('Safety PIN uses a cryptographically secure generator', th.includes('crypto.randomInt(1000, 10000)') && !/Math\.random/.test(th));
  report('A trip cannot be cancelled by ID alone (ownership enforced)', th.includes('OR: ownership') && !th.includes('where: tripId ? { id: tripId } :'));
  report('Driver cannot choose the payment method or tip at completion', th.includes("const paymentMethod = trip.paymentMethod || 'CASH';") && th.includes('const driverTip = trip.driverTipMWK || 0;'));
  report('Production requires a server-signed fare quote', th.includes("process.env.REQUIRE_FARE_QUOTE === 'true'") && th.includes('A valid fare quote is required'));
  report('REST ride completion is retired (410)', read('routes/rides.js').includes('ENDPOINT_RETIRED'));
  report('Admin and driver routes no longer use the JSON ledger',
    !/financeService\.ledger|cashSettlements/.test(read('routes/admin.js')) && !/financeService\.(getDriverFinancialSummary|submitCashCommissionSettlement)/.test(read('routes/drivers.js')));
  const frontEnd = ['rider/index.html', 'rider/app.js', 'driver/index.html', 'admin/index.html', ...listJs('shared')];
  const demo = frontEnd.filter((f) => /DRV-MW-|\b8421\b|Chisomo|Chikondi/.test(read(f)));
  report('Live screens contain no demo drivers, riders or fixed PINs', demo.length === 0, demo.join(', '));

  // --- Browser security policy must match what the pages actually use ---
  const serverSrc = read('server.js');
  const pages = ['rider/index.html', 'driver/index.html', 'admin/index.html', 'landing.html'];
  const withInline = pages.filter((f) => / on(click|change|input|submit|keydown|keyup)=/.test(read(f)));
  report('Pages use inline onclick handlers, so the policy must allow them (scriptSrcAttr)',
    withInline.length === 0 || /scriptSrcAttr:\s*\["'unsafe-inline'"\]/.test(serverSrc), withInline.join(', '));
  const hosts = new Set();
  for (const f of pages) {
    for (const m of read(f).matchAll(/(?:src|href)="(https?:\/\/[^"\/]+)/g)) hosts.add(m[1]);
    for (const m of read(f).matchAll(/url\('(https?:\/\/[^'\/]+)/g)) hosts.add(m[1]);
  }
  const blocked = [...hosts].filter((h) => !serverSrc.includes(h));
  report('Every third-party host the pages load is allowed by the security policy', blocked.length === 0, blocked.join(', '));
  const lan = pages.filter((f) => /https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(read(f)));
  report('No page contains a hardcoded LAN address', lan.length === 0, lan.join(', '));

  // --- Docker image must contain everything the server needs at runtime ---
  const docker = read('Dockerfile');
  const needed = ['services', 'routes', 'sockets', 'middleware', 'lib', 'rider', 'driver', 'admin', 'shared', 'assets', 'data', 'legal', 'scripts', 'prisma']
    .filter((d) => fs.existsSync(path.join(ROOT, d)));
  const missing = needed.filter((d) => !docker.includes(`/app/${d}`));
  report('Docker runtime image copies every folder the server needs', missing.length === 0, missing.join(', '));
  report('Docker image includes the landing page and the Prisma CLI for migrate deploy', docker.includes('/app/landing.html') && docker.includes('node_modules/prisma'));

  // --- The consent request the rider app sends must be accepted by the server ---
  const consentType = (read('shared/auth.js').match(/type:\s*'(TERMS_AND_PRIVACY)'/) || [])[1];
  report('Rider app consent request matches what the server accepts',
    !!consentType && read('routes/legal.js').includes(`type === '${consentType}'`));
  report('Consent IP is stored as a keyed hash, not a plain hash', /createHmac\('sha256'/.test(read('routes/legal.js')) && !/createHash\('sha256'\)\.update\(ip\)/.test(read('routes/legal.js')));
  report('Browser test refuses to share port 3000 with another server or test run', read('tests/test_playwright_booking.js').includes('Port 3000 is already in use'));

  // --- Dispatch must only offer rides to drivers with a recent GPS fix ---
  const dispatchSrc = read('services/dispatch.js');
  report('Production dispatch requires a GPS fix from the last 3 minutes (configurable)',
    dispatchSrc.includes('DRIVER_GPS_FRESH_SECONDS') && /NODE_ENV === 'production' \? 180/.test(dispatchSrc) && !dispatchSrc.includes('30 * 60 * 1000'));

  // --- Booking must really start dispatch, and offers must be answerable ---
  report('Booking a ride starts the nearest-driver dispatch (not just a broadcast)',
    th.includes('dispatchService.startDispatch(trip.id)') && th.includes("process.env.AUTO_DISPATCH !== 'false'"));
  report('Drivers can decline an offer, and only the driver holding it can',
    th.includes("socket.on('trip:decline'") && th.includes("status: 'PENDING' }") && read('shared/state.js').includes("emit('trip:decline'") && read('driver/index.html').includes('declineTrip('));
  report('In production a driver can only accept a ride that was offered to them',
    th.includes('REQUIRE_OFFER_TO_ACCEPT') && th.includes('This ride was not offered to you'));
  report('Cancelling a ride withdraws the open offer and tells the offered driver',
    th.includes("emitToDriver(io, o.driverId, 'trip:cancelled'") && th.includes('dispatchService.clearOfferTimer(trip.id)'));

  // --- Explicit consent (not silent) ---
  const authJs = read('shared/auth.js');
  report('Riders and drivers must tick the Terms and Privacy box before a login code is sent',
    authJs.includes('id="auth-consent"') && authJs.includes("if (consentBox && !consentBox.checked)") && authJs.includes("role !== 'ADMIN'"));
  report('Consent is recorded only after an explicit tick, and retried if the network failed',
    authJs.includes('if (role !== \'ADMIN\' && consentGiven)') && authJs.includes("'/api/consent'") && authJs.includes('retryPendingConsent'));
  report('The old silent consent call is gone from the rider screen', !read('rider/index.html').includes("fetch('/api/consent'"));
  report('Drivers must accept the Driver Agreement during onboarding',
    authJs.includes('id="onboard-agreement"') && authJs.includes("recordConsent('DRIVER_AGREEMENT')") && authJs.includes('driverAgreementRequired'));
  report('Consent wording exists in English and Chichewa (Chichewa flagged for native review)',
    (read('shared/i18n.js').match(/consentLead:/g) || []).length === 2 && /NEEDS NATIVE REVIEW[^\n]*consent wording/.test(read('shared/i18n.js')));
  report('The browser test ticks the consent box on every rider and driver login',
    (read('tests/test_playwright_booking.js').match(/#auth-consent'\)\.check\(\)/g) || []).length >= 2);

  // --- Map library is self-hosted ---
  const leafletPages = ['rider/index.html', 'admin/index.html'];
  report('Pages load the map library from our own server, not a third-party CDN',
    leafletPages.every((f) => read(f).includes('/vendor/leaflet/leaflet.js') && read(f).includes('/vendor/leaflet/leaflet.css')) &&
    !pages.some((f) => /unpkg\.com/.test(read(f))) && !serverSrc.includes('unpkg.com'));
  report('Leaflet is pinned in package.json and served at /vendor/leaflet',
    JSON.parse(read('package.json')).dependencies.leaflet === '1.9.4' && serverSrc.includes("app.use('/vendor/leaflet'"));
  const leafletFiles = ['leaflet.js', 'leaflet.css'].map((f) => path.join(ROOT, 'node_modules', 'leaflet', 'dist', f));
  report('Leaflet is installed locally (if this fails, run: npm install)',
    process.env.OFFLINE_SKIP_LEAFLET === '1' || leafletFiles.every((f) => fs.existsSync(f)), leafletFiles.filter((f) => !fs.existsSync(f)).length ? 'node_modules/leaflet is missing' : '');

  // --- Railway deployment config ---
  const railwayCfg = JSON.parse(read('railway.json'));
  report('Railway runs migrations before start and checks /api/health',
    railwayCfg.build.builder === 'DOCKERFILE' && railwayCfg.deploy.healthcheckPath === '/api/health' &&
    railwayCfg.deploy.preDeployCommand.some((c) => c.includes('prisma/build/index.js migrate deploy')));
  report('Container health check follows the PORT that Railway assigns', /localhost:\$\{PORT:-3000\}\/api\/health/.test(read('Dockerfile')));
  report('The deploy walkthrough exists and never says to run the seed in production',
    fs.existsSync(path.join(ROOT, 'docs/railway-deploy-walkthrough.md')) && /seed script must never be run against production/i.test(read('docs/railway-deploy-walkthrough.md')));

  // --- Public landing page ---
  report('The root URL serves the public landing page', /sendFile\(path\.join\(__dirname, 'landing\.html'\)\)/.test(serverSrc) && fs.existsSync(path.join(ROOT, 'landing.html')));
  const landing = read('landing.html');
  report('Landing page links the legal pages and makes no payment promises beyond cash',
    landing.includes('/legal/terms') && landing.includes('/legal/privacy') && /cash/i.test(landing) && !/airtel|tnm|mpamba/i.test(landing));

  console.log('\n=============================================================');
  console.log(`   OFFLINE SAFETY RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('=============================================================');
  process.exit(passed === total ? 0 : 1);
})().catch((err) => { console.error('Suite crashed:', err); process.exit(1); });
