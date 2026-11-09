'use strict';
// Ads (rider and driver apps), the audit trail, the messages log and driver earnings.
process.env.NODE_ENV = 'development';
let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };
const express = require('express'), crypto = require('crypto');
const rd2 = (f) => require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');

const db = { ads: [], audit: [], seq: 0, stored: [], removed: [] };
const prisma = {
  ad: {
    create: async ({ data }) => { const r = { id: 'AD' + (++db.seq), impressions: 0, clicks: 0, createdAt: new Date(Date.now() + db.seq), updatedAt: new Date(), ...data }; db.ads.push(r); return r; },
    findMany: async ({ where }) => db.ads.filter((a) => (!where.audience || a.audience === where.audience) && (where.active === undefined || a.active === where.active)).sort((a, b) => (b.priority - a.priority) || (b.createdAt - a.createdAt)),
    findUnique: async ({ where }) => db.ads.find((a) => a.id === where.id) || null,
    update: async ({ where, data }) => { const a = db.ads.find((x) => x.id === where.id); if (!a) throw new Error('nf'); Object.keys(data).forEach((k) => { const v = data[k]; if (v && typeof v === 'object' && 'increment' in v) a[k] += v.increment; else a[k] = v; }); return a; },
    delete: async ({ where }) => { db.ads = db.ads.filter((a) => a.id !== where.id); }
  },
  auditLog: {
    create: async ({ data }) => { db.audit.push(data); return data; },
    findMany: async ({ where }) => db.auditRows.filter((r) => (!where.action || r.action === where.action)).sort((x, y) => y.at - x.at).map((r) => ({ ...r, createdAt: r.at, user: r.user })),
    count: async ({ where }) => db.auditRows.filter((r) => (!where.action || r.action === where.action)).length
  },
  messageLog: {
    findMany: async ({ where }) => db.logs.filter((m) => (!where.channel || m.channel === where.channel) && (!where.status || m.status === where.status)),
    count: async ({ where }) => db.logs.filter((m) => (where.status.in ? where.status.in.includes(m.status) : m.status === where.status)).length
  },
  smsLog: { findMany: async () => [{ id: 'S1', createdAt: new Date('2026-11-09T09:00:00Z'), purpose: 'OTP', phoneMasked: '+265****123', status: 'SENT', provider: 'twilio' }] },
  trip: { groupBy: async () => [{ driverId: 'D1', _count: { _all: 3 }, _sum: { fareMWK: 5400, driverShareMWK: 3780, commissionMWK: 1620 } }, { driverId: 'D2', _count: { _all: 1 }, _sum: { fareMWK: 1800, driverShareMWK: 1260, commissionMWK: 540 } }] },
  driver: { findMany: async () => [{ id: 'D1', commissionDebtMWK: 1620, rating: 4.8, approvalStatus: 'APPROVED', user: { name: 'Test Driver', phone: '+265991000002' }, vehicle: { plateNumber: 'TEST 001', type: 'MOTO' } }, { id: 'D2', commissionDebtMWK: 540, rating: 5, approvalStatus: 'APPROVED', user: { name: 'Second', phone: '+265991000009' }, vehicle: { plateNumber: 'BW 123', type: 'MOTO' } }] }
};
db.auditRows = [{ id: 'A1', action: 'DRIVER_APPROVED', entityType: 'DRIVER', entityId: 'D1', at: new Date('2026-11-09T08:00:00Z'), user: { id: 'U9', name: 'Admin One', role: 'ADMIN' }, ipAddress: '1.2.3.4', details: { x: 1 } }, { id: 'A2', action: 'AD_CREATED', entityType: 'AD', entityId: 'AD1', at: new Date('2026-11-09T09:00:00Z'), user: null, ipAddress: null, details: null }];
db.logs = [{ id: 'M1', channel: 'EMAIL', purpose: 'LOGIN_CODE', toMasked: 'a***@g***.com', subject: 'Your Aarohan verification code', status: 'SENT', provider: 'brevo', error: null, createdAt: new Date('2026-11-09T10:00:00Z') }, { id: 'M2', channel: 'PUSH', purpose: 'TRIP_OFFER', toMasked: '1 device(s)', subject: 'New ride offer', status: 'FAILED', provider: 'fcm', error: '1 failed', createdAt: new Date('2026-11-09T11:00:00Z') }];
const pp = require.resolve('../lib/prisma'); require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: prisma };
const adMedia = require('../services/adMedia'); adMedia.store = async ({ ext }) => { db.stored.push(ext); return { path: 'file.' + ext, url: '/media/ads/file.' + ext }; }; adMedia.remove = async (p) => { db.removed.push(p); };
const ads = require('../services/adService'), adminData = require('../services/adminData');
const router = require('../routes/ads'), dataRouter = require('../routes/adminData');

const jpeg = (n = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(n)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
const mp4 = (n = 2000) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), crypto.randomBytes(n)]);
const webm = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), crypto.randomBytes(500)]);
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), crypto.randomBytes(500)]);
const rej = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

(async () => {
  console.log('--- What a file really is ---');
  report('Real JPG, PNG, WEBP pictures and MP4, WEBM videos are accepted', adMedia.sniff(jpeg()).type === 'IMAGE' && adMedia.sniff(png()).ext === 'png' && adMedia.sniff(webp()).ext === 'webp' && adMedia.sniff(mp4()).type === 'VIDEO' && adMedia.sniff(webm()).ext === 'webm');
  report('A script, a web page, an SVG, a PDF and a program are refused even if renamed .jpg', ['<script>alert(1)</script>....', '<html><body>hi</body></html>', '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', '%PDF-1.4 ......', 'MZ\x90\x00\x03\x00\x00\x00\x04\x00'].every((t) => adMedia.sniff(Buffer.from(t.padEnd(20, ' '))) === null));

  console.log('\n--- The details are checked ---');
  let e = await rej(() => ads.create({ audience: 'RIDER', title: 'Sale', linkUrl: 'javascript:alert(1)' }, { buffer: jpeg() }, 'A1'));
  report('A link that is not https is refused (javascript:, http:, data:)', e && /https/.test(e.message) && ['http://x.com', 'data:text/html,hi', 'ftp://x.com/a'].every((l) => { try { ads.clean({ audience: 'RIDER', title: 'Ok', linkUrl: l }); return false; } catch (x) { return true; } }));
  e = await rej(() => ads.create({ audience: 'ADMINS', title: 'Sale' }, { buffer: jpeg() }, 'A1'));
  report('Only the Rider app or the Driver app can be chosen', e && /Rider app or the Driver app/.test(e.message));
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'x' }, { buffer: jpeg() }, 'A1'));
  report('The title must be 2 to 80 characters', e && /title/.test(e.message));
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'Sale', startsAt: '2026-12-02', endsAt: '2026-12-01' }, { buffer: jpeg() }, 'A1'));
  report('The end cannot be before the start', e && /end must be after/.test(e.message));
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'Sale' }, { buffer: Buffer.concat([jpeg(), Buffer.alloc(5 * 1024 * 1024)]) }, 'A1'));
  report('A picture over 5 MB is refused', e && /5 MB/.test(e.message));
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'Sale' }, { buffer: Buffer.from('this is not media at all') }, 'A1'));
  report('A file that is not a picture or video is refused', e && /JPG, PNG, WEBP/.test(e.message));
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'Sale' }, null, 'A1'));
  report('An ad needs a picture or a video', e && /Choose a picture or a video/.test(e.message));

  console.log('\n--- Creating ads and what the apps see ---');
  const a1 = await ads.create({ audience: 'RIDER', title: 'Airtime offer', caption: 'Ride and win', linkUrl: 'https://example.com/promo', priority: '5' }, { buffer: jpeg() }, 'A1', '1.1.1.1');
  const a2 = await ads.create({ audience: 'RIDER', title: 'Video ad', priority: '9' }, { buffer: mp4() }, 'A1');
  const a3 = await ads.create({ audience: 'DRIVER', title: 'Fuel deal' }, { buffer: png() }, 'A1');
  const future = await ads.create({ audience: 'RIDER', title: 'Not yet', startsAt: new Date(Date.now() + 86400000).toISOString() }, { buffer: jpeg() }, 'A1');
  const ended = await ads.create({ audience: 'RIDER', title: 'Over', startsAt: new Date(Date.now() - 5 * 86400000).toISOString(), endsAt: new Date(Date.now() - 86400000).toISOString() }, { buffer: jpeg() }, 'A1');
  const off = await ads.create({ audience: 'RIDER', title: 'Paused', active: 'false' }, { buffer: jpeg() }, 'A1');
  report('A picture and a video are saved with the right type, and each creation is written to the audit trail', a1.mediaType === 'IMAGE' && a2.mediaType === 'VIDEO' && db.audit.filter((x) => x.action === 'AD_CREATED').length === 6 && db.audit[0].ipAddress === '1.1.1.1');
  const riderAds = await ads.listForApp('RIDER');
  report('The rider app gets only live rider ads, highest priority first (not scheduled, ended, paused or driver ads)', riderAds.map((x) => x.title).join() === 'Video ad,Airtime offer');
  report('The apps are never given admin details such as counters or who made the ad', riderAds.every((x) => !('impressions' in x) && !('createdBy' in x) && !('mediaPath' in x)));
  report('The driver app gets only driver ads', (await ads.listForApp('DRIVER')).map((x) => x.title).join() === 'Fuel deal');
  report('Statuses are right: live, scheduled, ended, off', ads.statusOf(a1) === 'LIVE' && ads.statusOf(future) === 'SCHEDULED' && ads.statusOf(ended) === 'ENDED' && ads.statusOf(off) === 'OFF');
  await ads.track(a1.id, 'impression'); await ads.track(a1.id, 'impression'); await ads.track(a1.id, 'click');
  const listed = (await ads.adminList('RIDER')).find((x) => x.id === a1.id);
  report('Views and taps are counted, and the tap rate is worked out (1 tap in 2 views is 50%)', listed.impressions === 2 && listed.clicks === 1 && listed.ctr === 50);
  await ads.update(a1.id, { active: false, title: 'Airtime offer 2' }, 'A1');
  report('An ad can be switched off and renamed, and that is audited', (await ads.listForApp('RIDER')).every((x) => x.id !== a1.id) && db.audit.some((x) => x.action === 'AD_UPDATED'));
  await ads.remove(a3.id, 'A1');
  report('Deleting an ad removes the row and the stored file, and is audited', !db.ads.find((x) => x.id === a3.id) && db.removed.includes(a3.mediaPath) && db.audit.some((x) => x.action === 'AD_DELETED'));

  console.log('\n--- Where an ad appears, and showing it only near a place ---');
  e = await rej(() => ads.create({ audience: 'DRIVER', title: 'Wrong spot', placement: 'SEARCHING' }, { buffer: jpeg() }, 'A1'));
  report('A driver ad cannot be put on a rider-only screen, and the rider screens are home, searching and completed', e && /where the ad appears/i.test(e.message) && Object.keys(ads.PLACEMENTS.RIDER).join() === 'HOME,SEARCHING,COMPLETED' && Object.keys(ads.PLACEMENTS.DRIVER).join() === 'HOME,EARNINGS');
  const wait = await ads.create({ audience: 'RIDER', title: 'Waiting ad', placement: 'SEARCHING' }, { buffer: jpeg() }, 'A1');
  const done = await ads.create({ audience: 'RIDER', title: 'Thank-you ad', placement: 'COMPLETED' }, { buffer: jpeg() }, 'A1');
  report('Each screen only gets the ads meant for it', (await ads.listForApp('RIDER', { placement: 'SEARCHING' })).map((x) => x.title).join() === 'Waiting ad' && (await ads.listForApp('RIDER', { placement: 'COMPLETED' })).map((x) => x.title).join() === 'Thank-you ad' && (await ads.listForApp('RIDER', { placement: 'HOME' })).every((x) => x.title !== 'Waiting ad'));
  const area3 = await ads.create({ audience: 'RIDER', title: 'Area 3 market', geoLat: '-13.9626', geoLng: '33.7741', geoRadiusKm: '3', geoLabel: 'Area 3' }, { buffer: jpeg() }, 'A1');
  const titles = async (o) => (await ads.listForApp('RIDER', { placement: 'HOME', ...o })).map((x) => x.title);
  report('An ad for one place is shown to a phone 1 km away', (await titles({ lat: -13.9700, lng: 33.7741 })).includes('Area 3 market'));
  report('It is NOT shown to a phone 20 km away, or in another city', !(await titles({ lat: -14.15, lng: 33.7741 })).includes('Area 3 market') && !(await titles({ lat: -15.7861, lng: 35.0058 })).includes('Area 3 market'));
  report('It is NOT shown when the phone gives no location (so a place ad never leaks everywhere)', !(await titles({})).includes('Area 3 market') && !(await titles({ lat: 'abc', lng: 'x' })).includes('Area 3 market'));
  report('Ads without a place still show everywhere, with or without a location', (await titles({})).includes('Video ad') && (await titles({ lat: -15.78, lng: 35.0 })).includes('Video ad'));
  report('The distance maths is right (Lilongwe to Blantyre is about 243 km in a straight line)', Math.abs(ads.distanceKm(-13.9626, 33.7741, -15.7861, 35.0058) - 243) < 6);
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'Out of country', geoLat: '17.38', geoLng: '78.48', geoRadiusKm: '5' }, { buffer: jpeg() }, 'A1'));
  report('A place outside Malawi is refused', e && /outside Malawi/.test(e.message));
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'Half a place', geoLat: '-13.96' }, { buffer: jpeg() }, 'A1'));
  report('A place needs the latitude, longitude and radius together', e && /latitude, the longitude and the radius/.test(e.message));
  e = await rej(() => ads.create({ audience: 'RIDER', title: 'Huge', geoLat: '-13.96', geoLng: '33.77', geoRadiusKm: '900' }, { buffer: jpeg() }, 'A1'));
  report('A radius over 500 km (or under half a km) is refused', e && /radius must be between/.test(e.message) && !!(await rej(() => ads.create({ audience: 'RIDER', title: 'Tiny', geoLat: '-13.96', geoLng: '33.77', geoRadiusKm: '0.1' }, { buffer: jpeg() }, 'A1'))));
  report('The apps are never told where an ad is aimed', (await ads.listForApp('RIDER', { placement: 'HOME', lat: -13.97, lng: 33.77 })).every((x) => !('geoLat' in x) && !('geoRadiusKm' in x) && !('placement' in x)));
  await ads.update(area3.id, { geoLat: '', geoLng: '', geoRadiusKm: '', placement: 'HOME' }, 'A1');
  report('Clearing the three place boxes makes the ad show everywhere again', (await titles({})).includes('Area 3 market'));
  e = await rej(() => ads.update(wait.id, { placement: 'EARNINGS' }, 'A1'));
  report('Moving an ad to a screen its app does not have is refused', e && /where the ad appears/i.test(e.message));
  report('The apps ask with the screen and a rounded location, and the server never stores it', /placement=/.test(rd2('rider/next/js/ads.js')) && /toFixed\(3\)/.test(rd2('rider/next/js/ads.js')) && !/geo|lat/i.test(rd2('routes/ads.js').replace(/req\.query\.lat|req\.query\.lng|lat: |lng: /g, '')));

  console.log('\n--- Who may do what ---');
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { const r = req.headers['x-role']; if (r) req.user = { id: 'U1', role: r }; next(); });
  app.use('/api', router); app.use('/api', dataRouter);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (m, p, role, body, form) => { const res = await fetch(base + p, { method: m, headers: { ...(role ? { 'x-role': role } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) }); return { status: res.status, body: await res.json().catch(() => ({})) }; };
  report('Not signed in: no ads and no admin tools', (await call('GET', '/ads?audience=RIDER')).status === 401 && (await call('GET', '/admin/ads')).status === 401);
  report('A rider can read ads but cannot open the admin tools', (await call('GET', '/ads?audience=RIDER', 'RIDER')).status === 200 && (await call('GET', '/admin/ads', 'RIDER')).status === 403 && (await call('DELETE', '/admin/ads/' + a2.id, 'RIDER')).status === 403);
  report('Support staff cannot create ads either (admin only)', (await call('GET', '/admin/ads', 'SUPPORT')).status === 403);
  const fd = new FormData(); fd.append('audience', 'DRIVER'); fd.append('title', 'Uploaded ad'); fd.append('media', new Blob([jpeg()], { type: 'image/jpeg' }), 'poster.jpg');
  const made = await call('POST', '/admin/ads', 'ADMIN', null, fd);
  report('An admin can upload a picture with the form, and it appears in the list', made.status === 200 && made.body.ad.title === 'Uploaded ad' && (await call('GET', '/admin/ads?audience=DRIVER', 'ADMIN')).body.ads.some((x) => x.title === 'Uploaded ad'));
  const bad = new FormData(); bad.append('audience', 'DRIVER'); bad.append('title', 'Bad'); bad.append('media', new Blob(['<script>alert(1)</script>............'], { type: 'image/jpeg' }), 'poster.jpg');
  report('A script disguised as a .jpg is refused by the server', (await call('POST', '/admin/ads', 'ADMIN', null, bad)).status === 400);
  report('Counting a tap works for a signed-in user and rejects unknown events', (await call('POST', '/ads/' + a2.id + '/event', 'RIDER', { type: 'click' })).status === 200 && (await call('POST', '/ads/' + a2.id + '/event', 'RIDER', { type: 'hack' })).status === 400);
  report('The audit trail and earnings pages are admin only, the messages log is for admin and support', (await call('GET', '/admin/audit', 'SUPPORT')).status === 403 && (await call('GET', '/admin/audit', 'ADMIN')).status === 200 && (await call('GET', '/admin/messages', 'SUPPORT')).status === 200 && (await call('GET', '/admin/messages', 'RIDER')).status === 403 && (await call('GET', '/admin/driver-earnings', 'SUPPORT')).status === 403 && (await call('GET', '/admin/driver-earnings', 'FINANCE')).status === 200);
  server.close();

  console.log('\n--- What the admin panel reads from the database ---');
  const at = await adminData.auditTrail({});
  report('The audit trail lists who did what, to what, and from where', at.total === 2 && at.rows[0].who === null && at.rows[1].who.name === 'Admin One' && at.rows[1].ip === '1.2.3.4');
  const ms = await adminData.messages({});
  report('The messages log joins emails, pushes and SMS, newest first, with 24 hour counts', ms.rows.length === 3 && ms.rows[0].channel === 'PUSH' && ms.rows.some((r) => r.channel === 'SMS') && ms.sentLast24h === 1 && ms.failedLast24h === 1);
  report('Only masked addresses appear, never a full email, phone or any message text', ms.rows.every((r) => !/@[a-z]+\.[a-z]{2,}$/i.test(r.to) || r.to.includes('***')) && !JSON.stringify(ms).includes('verification code is'));
  const en = await adminData.driverEarnings({});
  report('Driver earnings add up: fares, driver share, commission, and what is owed', en.rows.length === 2 && en.rows[0].gross === 5400 && en.totals.gross === 7200 && en.totals.driverShare === 5040 && en.totals.commission === 2160 && en.totals.owes === 2160 && en.totals.driverShare + en.totals.commission === en.totals.gross);

  console.log(`\n   ADS AND ADMIN DATA RESULTS: ${passed}/${total} TESTS PASSED`); process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('crashed', e); process.exit(1); });
