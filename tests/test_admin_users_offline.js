'use strict';
// Admin user access: staff only, search, full account view, suspend with audit. No database.
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.OTP_HMAC_SECRET = 'test-otp-hmac-secret-16plus';
const express = require('express');
let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };

const db = { users: [
  { id: 'R1', name: 'Rita Banda', phone: '+265991111111', email: 'rita@example.com', role: 'RIDER', status: 'ACTIVE', createdAt: new Date('2026-01-01'), referralCode: 'ARRITA22', referredById: 'R2', gender: 'FEMALE', dateOfBirth: new Date('1996-04-23') },
  { id: 'R2', name: 'Grace', phone: '+265992222222', email: 'grace@example.com', role: 'RIDER', status: 'ACTIVE', createdAt: new Date('2026-01-02'), referralCode: 'ARGRACE3' },
  { id: 'D1', name: 'Joseph', phone: '+265993333333', email: null, role: 'DRIVER', status: 'ACTIVE', createdAt: new Date('2026-01-03') },
  { id: 'A1', name: 'Boss', phone: '+265994444444', role: 'ADMIN', status: 'ACTIVE' }], audit: [], revoked: 0 };
const prisma = {
  user: {
    findMany: async ({ where }) => db.users.filter((u) => (!where.role || (where.role.in ? where.role.in.includes(u.role) : u.role === where.role)) && (!where.OR || where.OR.some((c) => (c.name && u.name.toLowerCase().includes(c.name.contains.toLowerCase())) || (c.phone && u.phone.includes(c.phone.contains))))),
    count: async ({ where }) => (where.referredById ? db.users.filter((u) => u.referredById === where.referredById).length : db.users.length),
    findUnique: async ({ where, include }) => { const u = db.users.find((x) => x.id === where.id); if (!u) return null; return { ...u, emergencyContacts: [{ name: 'Mum', phone: '+265998877665' }], savedPlaces: [], referredBy: u.referredById ? db.users.find((x) => x.id === u.referredById) : null, driverProfile: u.role === 'DRIVER' ? { id: 'DP1', approvalStatus: 'PENDING', vehicle: { plateNumber: 'BT 1234' } } : null }; },
    update: async ({ where, data }) => { Object.assign(db.users.find((x) => x.id === where.id), data); return {}; }
  },
  trip: { findMany: async () => [{ id: 'T1', status: 'COMPLETED' }], count: async () => 3 },
  supportTicket: { findMany: async () => [{ id: 'K1', subject: 'Fare' }] },
  refreshToken: { updateMany: async () => { db.revoked++; return { count: 1 }; } },
  auditLog: { create: async ({ data }) => { db.audit.push(data); return data; } }
};
const pp = require.resolve('../lib/prisma'); require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: prisma };
const router = require('../routes/adminUsers');

(async () => {
  console.log('--- Admin user access ---');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { const r = req.headers['x-role']; if (r) req.user = { id: r === 'ADMIN' ? 'A1' : 'S1', role: r }; next(); });
  app.use('/api', router);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (m, p, role, body) => { const res = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-role': role } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await res.json(); } catch (_) {} return { s: res.status, b: j }; };

  report('Nobody can list users without a staff login', (await call('GET', '/admin/users')).s === 401);
  report('A rider or driver cannot open the admin list', (await call('GET', '/admin/users', 'RIDER')).s === 403 && (await call('GET', '/admin/users', 'DRIVER')).s === 403);
  let r = await call('GET', '/admin/users', 'SUPPORT');
  report('Support staff can list riders and drivers (admins are not listed)', r.s === 200 && r.b.users.length === 3 && !r.b.users.some((u) => u.role === 'ADMIN'));
  r = await call('GET', '/admin/users?role=DRIVER', 'ADMIN');
  report('The list can be limited to drivers, or to riders', r.b.users.length === 1 && r.b.users[0].role === 'DRIVER' && (await call('GET', '/admin/users?role=RIDER', 'ADMIN')).b.users.length === 2);
  r = await call('GET', '/admin/users?q=rita', 'ADMIN');
  report('Search by name works', r.b.users.length === 1 && r.b.users[0].id === 'R1');
  r = await call('GET', '/admin/users/R1', 'SUPPORT');
  report('A full account view shows details, contacts, who referred them, trips and tickets', r.s === 200 && r.b.user.email === 'rita@example.com' && r.b.user.dateOfBirth === '1996-04-23' && r.b.user.emergencyContacts.length === 1 && r.b.user.referredBy.id === 'R2' && r.b.stats.completed === 3 && r.b.tickets.length === 1);
  report('Opening an account is audited', db.audit.some((a) => a.action === 'ADMIN_USER_VIEWED' && a.entityId === 'R1'));
  r = await call('GET', '/admin/users/D1', 'ADMIN');
  report('A driver account includes the driver profile and vehicle', r.s === 200 && r.b.user.driver.vehicle.plateNumber === 'BT 1234');
  report('Admin accounts cannot be opened through this screen', (await call('GET', '/admin/users/A1', 'ADMIN')).s === 404);
  report('Support staff cannot suspend (admin only)', (await call('POST', '/admin/users/R1/status', 'SUPPORT', { status: 'SUSPENDED', reason: 'abuse of drivers' })).s === 403);
  report('A reason is required to suspend', (await call('POST', '/admin/users/R1/status', 'ADMIN', { status: 'SUSPENDED', reason: 'x' })).s === 400);
  r = await call('POST', '/admin/users/R1/status', 'ADMIN', { status: 'SUSPENDED', reason: 'Repeated abuse of captains' });
  report('An admin can suspend: status changes, sessions are revoked, and it is audited with the reason', r.s === 200 && db.users[0].status === 'SUSPENDED' && db.revoked === 1 && db.audit.some((a) => a.action === 'ADMIN_USER_STATUS_CHANGED' && a.details.reason.includes('abuse')));
  r = await call('POST', '/admin/users/R1/status', 'ADMIN', { status: 'ACTIVE', reason: 'Appeal accepted' });
  report('...and reactivate', r.s === 200 && db.users[0].status === 'ACTIVE');
  const fs = require('fs');
  report('Tickets can be listed separately for riders and for drivers', /role === 'RIDER' \|\| role === 'DRIVER'/.test(fs.readFileSync(require('path').join(__dirname, '..', 'services/supportTicket.js'), 'utf8')) && /status, priority, category, role/.test(fs.readFileSync(require('path').join(__dirname, '..', 'routes/tickets.js'), 'utf8')));
  server.close();
  console.log(`\n   ADMIN USERS RESULTS: ${passed}/${total} TESTS PASSED`);
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('crashed', e); process.exit(1); });
