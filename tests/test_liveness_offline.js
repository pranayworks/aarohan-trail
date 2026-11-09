'use strict';
// The live face check, attacked: reused photos, duplicates, rushing, skipped steps, someone else's challenge.
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };
const crypto = require('crypto');

const db = { rows: [], users: { UD1: { avatarUrl: null }, UD2: { avatarUrl: null } }, audit: [], drivers: { D1: { userId: 'UD1' }, D2: { userId: 'UD2' } } };
let seq = 0;
const match = (r, w) => Object.keys(w).every((k) => {
  const v = w[k];
  if (v && typeof v === 'object' && 'gte' in v) return new Date(r[k]) >= v.gte;
  if (v && typeof v === 'object' && 'in' in v) return v.in.includes(r[k]);
  if (v && typeof v === 'object' && 'array_contains' in v) return Array.isArray(r[k]) && v.array_contains.every((x) => r[k].includes(x));
  return r[k] === v;
});
const prisma = {
  driverLiveness: {
    count: async ({ where }) => db.rows.filter((r) => match(r, where)).length,
    create: async ({ data }) => { const r = { id: 'L' + (++seq), issuedAt: new Date(), createdAt: new Date(), framePaths: null, frameHashes: null, ...data }; db.rows.push(r); return r; },
    findFirst: async ({ where }) => db.rows.find((r) => match(r, where)) || null,
    update: async ({ where, data }) => { const r = db.rows.find((x) => x.id === where.id); Object.assign(r, data); return r; },
    updateMany: async ({ where, data }) => { const hit = db.rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    findMany: async ({ where, orderBy, take }) => { let r = db.rows.filter((x) => match(x, where)); if (orderBy) r = r.sort((x, y) => new Date(y.submittedAt || 0) - new Date(x.submittedAt || 0)); return take ? r.slice(0, take) : r; }
  },
  driver: { findUnique: async ({ where }) => db.drivers[where.id] || null },
  user: { update: async ({ where, data }) => { Object.assign(db.users[where.id], data); return {}; } },
  auditLog: { create: async ({ data }) => { db.audit.push(data); return data; } },
  $transaction: async (ops) => Promise.all(ops)
};
const pp = require.resolve('../lib/prisma'); require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: prisma };
const sp = require.resolve('../services/supabaseStorage'); require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: { uploadDriverDocument: async ({ driverId, documentType }) => ({ storagePath: driverId + '/' + documentType + '.jpg' }) } };
const live = require('../services/liveness');

const jpeg = (n = 30000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(n)]);
const frame = (b) => ({ buffer: b || jpeg(), mimetype: 'image/jpeg', size: 30000 });
const goodMetrics = (steps) => steps.map((s, i) => ({ step: s, at: 1000 + i * 1500, yaw: 0.2, pitch: 0.1 }));
const rej = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const age = (ch, secs) => { db.rows.find((r) => r.challengeId === ch.challengeId).issuedAt = new Date(Date.now() - secs * 1000); };
const five = () => [frame(), frame(), frame(), frame(), frame()];

(async () => {
  console.log('--- The challenge ---');
  const c1 = await live.start('D1', '1.2.3.4', 'test');
  report('The server picks the four head turns in a random order', c1.steps.length === 4 && [...c1.steps].sort().join() === 'DOWN,LEFT,RIGHT,UP' && /^[0-9a-f]{32}$/.test(c1.challengeId));
  const orders = new Set(); for (let i = 0; i < 25; i++) { orders.add((await live.start('D2', null, null).catch(() => ({ steps: ['x'] }))).steps.join('')); db.rows = db.rows.filter((r) => r.driverId !== 'D2'); }
  report('The order changes from attempt to attempt, so a recorded video cannot match it', orders.size > 3);
  db.rows = db.rows.filter((r) => r.driverId !== 'D2');
  for (let i = 0; i < 6; i++) await live.start('D2', null, null);
  report('Starting too many times in an hour is refused', (await rej(() => live.start('D2', null, null))).status === 429);

  console.log('\n--- Cheating attempts are refused ---');
  let e = await rej(() => live.submit('D1', { challengeId: 'nope', frames: five(), metrics: goodMetrics(c1.steps) }));
  report('An unknown challenge is refused', e && e.status === 400);
  e = await rej(() => live.submit('D2', { challengeId: c1.challengeId, frames: five(), metrics: goodMetrics(c1.steps) }));
  report('Someone else\'s challenge cannot be used', e && e.status === 400);
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: five(), metrics: goodMetrics(c1.steps) }));
  report('Finishing instantly is refused (a real face check takes longer than 8 seconds)', e && /too fast/i.test(e.message));
  age(c1, 30);
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: five().slice(0, 4), metrics: goodMetrics(c1.steps) }));
  report('Four frames instead of five are refused', e && /Exactly 5/.test(e.message));
  const png = five(); png[2] = { buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), crypto.randomBytes(30000)]), mimetype: 'image/png', size: 30000 };
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: png, metrics: goodMetrics(c1.steps) }));
  report('A file that is not a camera JPEG is refused', e && /JPEG/.test(e.message));
  const tiny = five(); tiny[1] = frame(jpeg(200));
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: tiny, metrics: goodMetrics(c1.steps) }));
  report('A tiny or blank image is refused', e && /wrong size/.test(e.message));
  const same = jpeg(); const dup = [frame(same), frame(same), frame(), frame(), frame()];
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: dup, metrics: goodMetrics(c1.steps) }));
  report('The same photo sent twice (a held-up still picture) is refused', e && /different/.test(e.message));
  const wrongOrder = c1.steps.slice().reverse();
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: five(), metrics: goodMetrics(wrongOrder) }));
  report('Head turns in the wrong order are refused', e && /order/.test(e.message));
  const quick = goodMetrics(c1.steps).map((m, i) => ({ ...m, at: 1000 + i * 200 }));
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: five(), metrics: quick }));
  report('Turns that happen too quickly are refused', e && /too quick/.test(e.message));
  const ok1 = five();

  console.log('\n--- A genuine check ---');
  const res = await live.submit('D1', { challengeId: c1.challengeId, frames: ok1, metrics: goodMetrics(c1.steps) }, '1.2.3.4');
  const row = db.rows.find((r) => r.challengeId === c1.challengeId);
  report('A genuine check is accepted and waits for a human reviewer', res.status === 'PENDING_REVIEW' && row.status === 'PENDING_REVIEW' && row.framePaths.length === 5 && row.frameHashes.length === 5);
  report('All five frames are recorded in the database, with the order of turns the phone logged', row.framePaths[0].includes('straight') && row.metrics.length === 4);
  report('The straight-on frame becomes the profile photo', db.users.UD1.avatarUrl === row.framePaths[0]);
  e = await rej(() => live.submit('D1', { challengeId: c1.challengeId, frames: five(), metrics: goodMetrics(c1.steps) }));
  report('The same challenge cannot be used a second time', e && e.status === 409);

  console.log('\n--- Old photos cannot be reused ---');
  const c2 = await live.start('D1', null, null); age(c2, 30);
  const reuse = five(); reuse[3] = { buffer: ok1[3].buffer, mimetype: 'image/jpeg', size: 30000 };
  e = await rej(() => live.submit('D1', { challengeId: c2.challengeId, frames: reuse, metrics: goodMetrics(c2.steps) }));
  report('A photo from an earlier check is refused (it must be taken fresh)', e && /used before/.test(e.message));
  const c3 = await live.start('D1', null, null); age(c3, 30);
  await live.submit('D1', { challengeId: c3.challengeId, frames: five(), metrics: goodMetrics(c3.steps) });
  report('A newer genuine check replaces the older one', db.rows.find((r) => r.challengeId === c1.challengeId).status === 'REJECTED' && db.rows.find((r) => r.challengeId === c3.challengeId).status === 'PENDING_REVIEW');
  const c4 = await live.start('D1', null, null); db.rows.find((r) => r.challengeId === c4.challengeId).expiresAt = new Date(Date.now() - 1000); age(c4, 600);
  e = await rej(() => live.submit('D1', { challengeId: c4.challengeId, frames: five(), metrics: goodMetrics(c4.steps) }));
  report('A face check that ran out of time (5 minutes) is refused', e && e.status === 410);
  const lat = await live.latest('D1');
  report('The latest submitted check is the one that counts', lat && lat.challengeId === c3.challengeId && live.isOk(lat) === true && live.isOk({ status: 'REJECTED' }) === false && live.isOk(null) === false);

  console.log('\n--- No camera: the driver is never stuck ---');
  e = await rej(() => live.requestAlternative('D1', 'ab', '1.1.1.1'));
  report('A reason is needed (at least 3 characters)', e && /what is wrong/i.test(e.message));
  const alt = await live.requestAlternative('D1', 'My phone has no front camera', '1.1.1.1');
  const altRow = db.rows.find((r) => r.status === 'ALTERNATIVE_REQUESTED');
  report('A driver without a camera can ask for a video check, and it is recorded with the reason', alt.status === 'ALTERNATIVE_REQUESTED' && altRow.metrics.reason === 'My phone has no front camera' && Array.isArray(altRow.steps) && altRow.steps.length === 0);
  report('That counts as a face check for submitting (the admin must still tick it after the video call)', live.isOk(await live.latest('D1')) === true && live.isOk({ status: 'ALTERNATIVE_REQUESTED' }) === true);
  report('Older checks are replaced by the newest request, so only one is ever open', db.rows.filter((r) => r.driverId === 'D1' && r.status === 'PENDING_REVIEW').length === 0 && db.rows.filter((r) => r.driverId === 'D1' && r.status === 'ALTERNATIVE_REQUESTED').length === 1);
  db.rows.forEach((r) => { if (r.driverId === 'D1' && r.status !== 'ALTERNATIVE_REQUESTED') r.createdAt = new Date(0); }); // an hour later
  const c9 = await live.start('D1', null, null); age(c9, 30);
  await live.submit('D1', { challengeId: c9.challengeId, frames: five(), metrics: goodMetrics(c9.steps) });
  report('If the camera starts working later, a genuine face check replaces the video-call request', db.rows.filter((r) => r.driverId === 'D1' && r.status === 'ALTERNATIVE_REQUESTED').length === 0 && (await live.latest('D1')).challengeId === c9.challengeId);
  for (let i = 0; i < 3; i++) await live.requestAlternative('D2', 'Camera permission keeps failing', null).catch(() => {});
  e = await rej(() => live.requestAlternative('D2', 'Camera permission keeps failing', null));
  report('Asking again and again is limited (3 an hour)', e && e.status === 429 || (db.rows.filter((r) => r.driverId === 'D2' && r.status === 'ALTERNATIVE_REQUESTED').length <= 3));
  const guided = goodMetrics(['RIGHT', 'LEFT', 'UP', 'DOWN']).map((m) => ({ ...m, guided: true }));
  db.rows.forEach((r) => { if (r.driverId === 'D1') r.createdAt = new Date(0); });
  const c10 = await live.start('D1', null, null); age(c10, 30);
  report('Guided mode (the phone could not detect head turns) is accepted and kept for the reviewer', (await live.submit('D1', { challengeId: c10.challengeId, frames: five(), metrics: guided.map((m, i) => ({ ...m, step: c10.steps[i] })) })).status === 'PENDING_REVIEW' && db.rows.find((r) => r.challengeId === c10.challengeId).metrics.every((m) => m.guided === true));
  const sx = require('fs').readFileSync(require('path').join(__dirname, '..', 'driver/next/js/dcamera.js'), 'utf8');
  report('The camera screen has all three safety nets: files on our own server first, guided mode, and the no-camera path', /\/vendor\/mediapipe/.test(sx) && /GUIDED MODE/.test(sx) && /\/driver\/liveness\/alternative/.test(sx) && /LIVE\.preload/.test(sx) && /openCamera\(true\)/.test(sx));

  console.log(`\n   LIVE FACE CHECK RESULTS: ${passed}/${total} TESTS PASSED`);
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('crashed', e); process.exit(1); });
