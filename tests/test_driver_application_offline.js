'use strict';
// Strict driver application rules. No database, no network.
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.OTP_HMAC_SECRET = 'test-otp-hmac-secret-16plus';
delete process.env.KYC_ENCRYPTION_KEY;
let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const db = { drivers: [], kycs: [], audit: [], trips: [], offers: [], rems: [] };
const user = { id: 'U1', name: 'Joseph Phiri', phone: '+265991111111', email: 'j@example.com', dateOfBirth: new Date('1990-05-05'), avatarUrl: null };
const driver = { id: 'D1', userId: 'U1', approvalStatus: 'PENDING', rejectionReason: null, commissionDebtMWK: 0, rating: 4.8, ratingCount: 12, tripsCompleted: 40, vehicle: { type: 'MOTO', makeModel: 'Boxer 150', color: 'Red', plateNumber: 'BT 1234', year: 2020 }, documents: [], user };
db.drivers.push(driver);
const withKyc = (d) => ({ ...d, kyc: db.kycs.find((k) => k.driverId === d.id) || null });
const prisma = {
  driver: {
    findFirst: async ({ where }) => { const d = db.drivers.find((x) => x.userId === where.userId); return d ? withKyc(d) : null; },
    findUnique: async ({ where }) => { const d = db.drivers.find((x) => x.id === where.id); return d ? withKyc(d) : null; },
    update: async ({ where, data }) => { Object.assign(db.drivers.find((x) => x.id === where.id), data); return {}; }
  },
  driverKyc: {
    create: async ({ data }) => { if (db.kycs.some((k) => k.nationalIdHash === data.nationalIdHash || k.licenseHash === data.licenseHash)) { const e = new Error('dup'); e.code = 'P2002'; throw e; } const k = { id: 'K' + (db.kycs.length + 1), submittedAt: null, checklist: null, ...data }; db.kycs.push(k); return k; },
    update: async ({ where, data }) => { const k = db.kycs.find((x) => x.driverId === where.driverId); Object.assign(k, data); return k; },
    findUnique: async ({ where }) => db.kycs.find((x) => x.driverId === where.driverId) || null
  },
  trip: {
    count: async ({ where }) => db.trips.filter((t) => t.driverId === where.driverId && (!where.status || t.status === where.status) && (!where.completedAt || t.completedAt >= where.completedAt.gte) && (!where.createdAt || (t.createdAt || t.completedAt) >= where.createdAt.gte)).length,
    findMany: async ({ where }) => db.trips.filter((t) => (t.createdAt || t.completedAt) >= where.createdAt.gte && t.pickupLat != null)
  },
  tripOffer: { count: async ({ where }) => db.offers.filter((o) => o.driverId === where.driverId && (!where.status || o.status === where.status)).length },
  commissionRemittance: {
    aggregate: async ({ where }) => ({ _sum: { amountMWK: db.rems.filter((r) => r.driverId === where.driverId && r.status === where.status).reduce((a, r) => a + r.amountMWK, 0) } }),
    findMany: async ({ where }) => db.rems.filter((r) => r.driverId === where.driverId)
  },
  auditLog: { create: async ({ data }) => { db.audit.push(data); return data; } },
  $transaction: async (ops) => Promise.all(ops)
};
const pp = require.resolve('../lib/prisma'); require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: prisma };
const crypto2 = require('../services/fieldCrypto');
const app = require('../services/driverApplication');

const good = () => ({ legalName: 'Joseph Phiri', nationalId: 'MW1234567', licenseNumber: 'DL-998877', licenseClass: 'a', licenseExpiry: day(400), address: 'Area 25, Lilongwe', district: 'Lilongwe', nextOfKinName: 'Mary Phiri', nextOfKinPhone: '0998877665', nextOfKinRelation: 'Wife', payoutNetwork: 'AIRTEL_MONEY', payoutPhone: '0991111111', registrationExpiry: day(200), insurancePolicyNo: 'POL-2026-001', insuranceExpiry: day(90), fitnessExpiry: day(120) });
const rej = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

(async () => {
  console.log('--- Encryption ---');
  const blob = crypto2.encrypt('MW1234567');
  report('IDs are stored encrypted and read back correctly', blob.startsWith('v1:') && !blob.includes('MW1234567') && crypto2.decrypt(blob) === 'MW1234567');
  report('Encrypting twice gives different text (no pattern leaks)', crypto2.encrypt('MW1234567') !== blob);
  report('A tampered value is refused', !!(await rej(async () => crypto2.decrypt(blob.slice(0, -4) + 'AAAA'))));
  report('The duplicate-check fingerprint ignores spaces, dashes and case', crypto2.fingerprint('dl-998877') === crypto2.fingerprint('DL 998877') && crypto2.fingerprint('A') !== crypto2.fingerprint('B'));
  process.env.NODE_ENV = 'production';
  report('In production there is no fallback key: without KYC_ENCRYPTION_KEY it refuses', !!(await rej(async () => crypto2.encrypt('x'))));
  process.env.NODE_ENV = 'development';

  console.log('\n--- Details are checked strictly ---');
  let e = await rej(() => app.saveKyc('U1', { ...good(), licenseExpiry: day(5) }));
  report('A licence that expires within 30 days is refused', e && /licence/i.test(e.message));
  e = await rej(() => app.saveKyc('U1', { ...good(), insuranceExpiry: day(-3) }));
  report('Expired insurance is refused', e && /insurance/i.test(e.message));
  e = await rej(() => app.saveKyc('U1', { ...good(), nationalId: 'ab' }));
  report('A bad National ID is refused', e && e.status === 400);
  e = await rej(() => app.saveKyc('U1', { ...good(), nextOfKinPhone: '0991111111' }));
  report('Next of kin cannot be the driver\'s own number', e && e.field === 'nextOfKinPhone');
  e = await rej(() => app.saveKyc('U1', { ...good(), payoutPhone: '12345' }));
  report('An invalid payout number is refused', e && e.field === 'payoutPhone');
  e = await rej(() => app.saveKyc('U1', { ...good(), licenseExpiry: '2027-13-45' }));
  report('A nonsense date is refused', !!e);

  let a = await app.saveKyc('U1', good());
  report('Valid details are saved; only the last 4 digits come back', a.kyc && a.kyc.nationalIdLast4 === '4567' && a.kyc.licenseLast4 === '8877' && !JSON.stringify(a).includes('MW1234567') && !JSON.stringify(a).includes('DL-998877'));
  report('The database holds the encrypted values, never the plain ones', !JSON.stringify(db.kycs).includes('MW1234567') && !JSON.stringify(db.kycs).includes('DL-998877'));
  report('The licence class is normalised and phones are put in +265 form', db.kycs[0].licenseClass === 'A' && db.kycs[0].nextOfKinPhone === '+265998877665');

  console.log('\n--- One identity, one account ---');
  db.drivers.push({ id: 'D2', userId: 'U2', approvalStatus: 'PENDING', vehicle: { plateNumber: 'BT 9999' }, documents: [], user: { id: 'U2', name: 'Other', phone: '+265992222222', dateOfBirth: new Date('1991-01-01') } });
  e = await rej(() => app.saveKyc('U2', { ...good(), nextOfKinPhone: '0997766554', payoutPhone: '0992222222' }));
  report('The same National ID and licence on a second account is refused', e && e.status === 409 && /already registered/i.test(e.message));

  console.log('\n--- Submitting ---');
  a = await app.getApplication('U1');
  report('Missing documents and the live face check are listed, and it cannot be submitted yet', !a.canSubmit && a.missing.some((m) => m.includes('NATIONAL_ID')) && a.missing.includes('Live face check'));
  e = await rej(() => app.submit('U1', true));
  report('Submitting an incomplete application is refused with the list of what is missing', e && e.missing && e.missing.length >= 6);
  app.REQUIRED_DOCS.forEach((t) => driver.documents.push({ type: t, status: 'PENDING' })); driver.liveness = [{ status: 'REJECTED', submittedAt: new Date() }];
  e = await rej(() => app.submit('U1', true));
  report('A rejected face check must be redone before submitting', e && e.missing && e.missing.includes('Redo the live face check'), e && e.message);
  driver.liveness = [{ status: 'PENDING_REVIEW', submittedAt: new Date() }];
  e = await rej(() => app.submit('U1', false));
  report('The accuracy declaration must be accepted', e && /declaration/i.test(e.message));
  driver.documents[0].status = 'REJECTED';
  e = await rej(() => app.submit('U1', true));
  report('A rejected document must be replaced before re-submitting', e && e.missing.some((m) => m.startsWith('Replace rejected')));
  driver.documents[0].status = 'PENDING';
  a = await app.submit('U1', true);
  report('A complete application can be submitted', a.submitted && a.locked && a.approvalStatus === 'PENDING' && db.kycs[0].declarationAcceptedAt instanceof Date);
  e = await rej(() => app.saveKyc('U1', good()));
  report('While under review the details are locked', e && e.status === 423);

  console.log('\n--- Approval is gated ---');
  let gate = await app.approvalGate('D1');
  report('A submitted but un-reviewed driver cannot be approved', !gate.ok && gate.missing.some((m) => m.startsWith('Not confirmed')));
  const none = {}; app.CHECKLIST.forEach(([k]) => { none[k] = true; }); none.licenceVerified = false;
  await app.saveChecklist('D1', 'A1', none);
  gate = await app.approvalGate('D1');
  report('One unticked item blocks approval', !gate.ok && gate.missing.length === 1 && /licence was verified/i.test(gate.missing[0]));
  none.licenceVerified = true; await app.saveChecklist('D1', 'A1', none);
  report('With every item confirmed the gate opens', (await app.approvalGate('D1')).ok === true && db.kycs[0].checklistBy === 'A1');
  report('A driver who never submitted can never pass the gate', (await app.approvalGate('D2')).ok === false);
  const adm = await app.adminKyc('D1', { full: true });
  report('The reviewer sees the full ID and licence numbers and the checklist items', adm.kyc.nationalId === 'MW1234567' && adm.kyc.licenseNumber === 'DL-998877' && adm.checklistItems.length === 13 && adm.checklistItems[0].key === 'livenessVerified' && adm.checklistItems.some((i) => i.key === 'plateMatches') && adm.checklistItems.some((i) => i.key === 'vehiclePhotoMatches'), JSON.stringify({ n: adm.checklistItems.length, id: adm.kyc && adm.kyc.nationalId }));
  delete process.env.STRICT_DRIVER_APPROVAL;
  report('The strict rule is on in production and in development', (process.env.NODE_ENV = 'production', app.strictApproval()) === true && (process.env.NODE_ENV = 'development', app.strictApproval()) === true);
  process.env.STRICT_DRIVER_APPROVAL = 'true';
  report('...and it can be switched on explicitly', app.strictApproval() === true);

  console.log('\n--- Daily incentives ---');
  const now = Date.now();
  for (let i = 0; i < 6; i++) db.trips.push({ driverId: 'D1', status: 'COMPLETED', completedAt: new Date(now - i * 60000) });
  db.trips.push({ driverId: 'D1', status: 'COMPLETED', completedAt: new Date(now - 3 * 86400000) }, { driverId: 'D1', status: 'CANCELLED_BY_DRIVER', completedAt: new Date(now) });
  const inc = await app.incentives('D1');
  report('Only completed trips from today count', inc.today === 6 && inc.week >= 6);
  report('Goals show what is reached and how many trips remain (8, 15 and 25 trips by default)', !inc.tiers[0].reached && inc.tiers[0].trips === 8 && inc.next.trips === 8 && inc.next.remaining === 2);
  report('The default bonuses stay affordable: each is at most about 11% of the commission Aarohan earns on that many trips', inc.tiers.every((x) => x.bonusMWK / (x.trips * 540) <= 0.12));
  report('Bonus amounts can be set by the owner', (process.env.DRIVER_INCENTIVES_JSON = '[{"trips":25,"bonusMWK":9000}]', (await app.incentives('D1')).tiers[0].bonusMWK) === 9000);
  const midnight = app.startOfBlantyreDay(new Date('2026-11-09T23:30:00Z'));
  report('"Today" follows Malawi time (UTC+2)', midnight.toISOString() === '2026-11-09T22:00:00.000Z');

  console.log('\n--- Approval reaches the driver ---');
  const fsx = require('fs'), px = require('path'); const rd = (f) => fsx.readFileSync(px.join(__dirname, '..', f), 'utf8');
  report('Approving pushes a live message straight to that driver', /to\(`user:\$\{driver\.userId\}`\)\.emit\('driver:status_changed'/.test(rd('routes/admin.js')));
  report('The driver is also emailed when approved', /onDriverApproved/.test(rd('routes/admin.js')) && /onDriverApproved/.test(rd('services/supportMail.js')));
  report('The driver app shows a success screen on approval and re-checks every 5 seconds', /AR\.register\('approved'/.test(rd('driver/next/js/dapply.js')) && /setInterval\(check, 5000\)/.test(rd('driver/next/js/dapply.js')));
  report('A server error never sends a driver back to step 1', /AR\.nav\.go\('retry'/.test(rd('driver/next/js/dapp.js')) && /e\.status === 404 && e\.data && e\.data\.error/.test(rd('driver/next/js/dapp.js')));

  console.log('\n--- Found during the live ride test ---');
  report('A driver is sent the parcel details (receiver, item, who pays) but never the delivery code', /safeParcel\(p\)/.test(rd('services/dispatch.js')) && !/deliveryCodeHash\s*:\s*p\./.test(rd('services/dispatch.js')) && /attachParcelForDriver/.test(rd('sockets/tripHandlers.js')) && /safeParcel\(activeTrip\.parcelDetail\)/.test(rd('routes/rides.js')));
  report('Reopening the driver app shows the real online state from the server', /availability: d\.availability/.test(rd('services/driverApplication.js')) && /a\.availability === 'ONLINE'/.test(rd('driver/next/js/dapp.js')));
  report('A resumed trip reconnects the shared store so chat works after a reload', /ss\.activeTrip\.id !== T\.id/.test(rd('driver/next/js/ddrive.js')));

  console.log('\n--- Commission, performance and busy areas ---');
  driver.commissionDebtMWK = 1000; db.rems.push({ driverId: 'D1', amountMWK: 2500, status: 'PENDING_VERIFICATION', submittedAt: new Date() }, { driverId: 'D1', amountMWK: 4000, status: 'VERIFIED', submittedAt: new Date() });
  let cs = await app.commissionSummary('D1');
  report('Commission summary shows what is owed, the limit (MK 2,500), and what is waiting to be verified', cs.debtMWK === 1000 && cs.limitMWK === 2500 && cs.pendingMWK === 2500 && cs.level === 'OK' && cs.remittances.length === 2);
  driver.commissionDebtMWK = 2000; cs = await app.commissionSummary('D1');
  report('At 80% of the limit (MK 2,000) the driver is warned (HIGH)', cs.level === 'HIGH');
  driver.commissionDebtMWK = 2499; cs = await app.commissionSummary('D1');
  report('One kwacha under the limit is still allowed', cs.level === 'HIGH');
  driver.commissionDebtMWK = 2500; cs = await app.commissionSummary('D1');
  report('REACHING the limit (MK 2,500) blocks the driver (BLOCKED)', cs.level === 'BLOCKED');
  const lim = require('../services/commissionLimit');
  report('The shared rule: below 2,500 is fine, 2,500 and above is blocked, and the limit can be changed in .env', lim.reached(2499) === false && lim.reached(2500) === true && lim.reached(9000) === true && lim.DEFAULT_LIMIT_MWK === 2500 && (process.env.MAX_COMMISSION_DEBT_MWK = '4000', lim.reached(3000)) === false && (delete process.env.MAX_COMMISSION_DEBT_MWK, true));
  report('Dispatch skips a driver who has reached the limit, going online is refused at the limit, and a finished trip switches them off', /lt: maxDebtLimit/.test(rd('services/dispatch.js')) && /commissionDebtMWK >= MAX_COMMISSION_DEBT_MWK/.test(rd('sockets/tripHandlers.js')) && /driver:commission_limit/.test(rd('sockets/tripHandlers.js')));
  ['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'REJECTED', 'REJECTED', 'EXPIRED'].forEach((st) => db.offers.push({ driverId: 'D1', status: st }));
  const pf = await app.performance('D1');
  report('Performance: acceptance rate is accepted offers out of all offers (7 of 10 is 70%)', pf.offers === 10 && pf.accepted === 7 && pf.declined === 2 && pf.missed === 1 && pf.acceptanceRate === 70);
  report('Performance carries rating and completed trips from the driver record', pf.rating === 4.8 && pf.ratingCount === 12 && pf.tripsCompleted === 40);
  const nowT = new Date(); [[-13.962, 33.787], [-13.9624, 33.7874], [-13.9618, 33.7869], [-13.99, 33.70]].forEach((p) => db.trips.push({ driverId: 'X', status: 'REQUESTED', createdAt: nowT, pickupLat: p[0], pickupLng: p[1] }));
  db.trips.push({ driverId: 'X', status: 'REQUESTED', createdAt: new Date(Date.now() - 3 * 3600000), pickupLat: -13.5, pickupLng: 33.5 });
  const hs = await app.hotspots();
  report('Busy areas group recent requests into about 1 km squares and ignore old ones', hs.length === 2 && hs[0].count === 3 && hs[1].count === 1);
  report('Busy areas show only counts and square centres, never rider details', hs.every((h) => Object.keys(h).sort().join() === 'count,lat,lng'));

  console.log('\n--- Expired documents ---');
  const today = new Date(); const dayMs = 86400000;
  db.kycs[0].licenseExpiry = new Date(today.getTime() + 30 * dayMs); db.kycs[0].insuranceExpiry = new Date(today.getTime() + 30 * dayMs); db.kycs[0].registrationExpiry = new Date(today.getTime() + 30 * dayMs); db.kycs[0].fitnessExpiry = new Date(today.getTime() + 30 * dayMs);
  report('Valid documents do not block the driver', (await app.expiredDocuments('D1')).length === 0);
  db.kycs[0].insuranceExpiry = new Date(today.getTime() - 3 * dayMs);
  let ex = await app.expiredDocuments('D1');
  report('An expired insurance certificate is found by name', ex.length === 1 && ex[0] === 'insurance');
  db.kycs[0].licenseExpiry = new Date(today.getTime() - dayMs);
  ex = await app.expiredDocuments('D1');
  report('Several expired documents are all found', ex.length === 2 && ex.includes('driving licence'));
  report('Expired documents stop the driver going online and accepting trips', /expiredDocuments\(socket\.driverId\)/.test(rd('sockets/tripHandlers.js')) && /Renew it before accepting trips/.test(rd('sockets/tripHandlers.js')));
  report('The driver is told by email and in the app that verification takes up to 24 hours', /within 24 hours/.test(rd('services/supportMail.js')) && /up to 24 hours/.test(rd('routes/me.js')));

  console.log('\n--- Number plate and vehicle photos, order, and who sees what ---');
  report('The two new photos are mandatory, in a fixed order, after the registration book', app.REQUIRED_DOCS.join() === 'NATIONAL_ID,DRIVING_LICENSE,VEHICLE_REGISTRATION,NUMBER_PLATE_PHOTO,VEHICLE_PHOTO,CERTIFICATE_OF_FITNESS,INSURANCE_CERTIFICATE');
  const savedDocs = driver.documents.slice(); driver.documents = driver.documents.filter((d) => d.type !== 'NUMBER_PLATE_PHOTO');
  let ap = await app.getApplication('U1');
  report('A missing number plate photo blocks the application and is named', !ap.canSubmit && ap.missing.some((m) => m.includes('NUMBER_PLATE_PHOTO')));
  driver.documents = driver.documents.filter((d) => d.type !== 'VEHICLE_PHOTO'); ap = await app.getApplication('U1');
  report('A missing vehicle photo blocks the application too', ap.missing.some((m) => m.includes('VEHICLE_PHOTO')));
  driver.documents = savedDocs;
  report('The database and the upload route know the new photo types', /NUMBER_PLATE_PHOTO/.test(rd('prisma/schema.prisma')) && /VEHICLE_PHOTO/.test(rd('prisma/schema.prisma')) && /NUMBER_PLATE_PHOTO/.test(rd('routes/drivers.js')) && /ADD VALUE IF NOT EXISTS 'NUMBER_PLATE_PHOTO'/.test(rd('prisma/migrations/20261113_vehicle_photo_types/migration.sql')));
  const admFull = await app.adminKyc('D1', { full: true }), admSupport = await app.adminKyc('D1', { full: false });
  report('An admin sees the full ID and licence numbers', admFull.kyc.nationalId === 'MW1234567' && admFull.kyc.licenseNumber === 'DL-998877' && admFull.kyc.numbersMasked === false);
  report('Support staff see only the last four digits', admSupport.kyc.nationalId === '********4567' && admSupport.kyc.licenseNumber === '********8877' && admSupport.kyc.numbersMasked === true && !JSON.stringify(admSupport).includes('MW1234567'));
  report('The route decides by role, and the admin document viewer is watermarked', /full: req\.user\.role === 'ADMIN'/.test(rd('routes/driverApplication.js')) && /Aarohan confidential/.test(rd('admin/index.html')));
  const dapplySrc = rd('driver/next/js/dapply.js'), dacc = rd('driver/next/js/daccount.js');
  report('The driver app has a name and instructions for every required photo and document', app.REQUIRED_DOCS.every((k) => new RegExp(k + ': \\[').test(dapplySrc) && new RegExp(k + ': ').test(dacc)));
  report('The app opens each step only after the one above is finished', /Finish the step above first/.test(dapplySrc));

  console.log('\n--- Document photo rules, strict approval, who may approve ---');
  const rules = require('../services/documentRules');
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('abcdefgh')]);
  report('Only real JPEG camera photos pass: a PDF, a PNG and an empty file are refused', rules.isJpeg(jpg) && !rules.isJpeg(Buffer.from('%PDF-1.4 ....')) && !rules.isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2])) && !rules.isJpeg(Buffer.alloc(0)));
  report('Every photo gets a fingerprint, and the same photo always gives the same one', rules.fingerprint(jpg) === rules.fingerprint(Buffer.from(jpg)) && rules.fingerprint(jpg) !== rules.fingerprint(Buffer.concat([jpg, Buffer.from('x')])) && rules.fingerprint(jpg).length === 64);
  report('Nothing can be uploaded when approved, suspended, or while the application is being reviewed', rules.canUpload({ approvalStatus: 'APPROVED' }, null).status === 409 && rules.canUpload({ approvalStatus: 'SUSPENDED' }, null).status === 403 && rules.canUpload({ approvalStatus: 'PENDING' }, { submittedAt: new Date() }).status === 409 && rules.canUpload(null, null).status === 400);
  report('A new or rejected applicant can upload', rules.canUpload({ approvalStatus: 'PENDING' }, null).ok === true && rules.canUpload({ approvalStatus: 'PENDING' }, { submittedAt: null }).ok === true && rules.canUpload({ approvalStatus: 'REJECTED' }, { submittedAt: new Date() }).ok === true);
  const dr = rd('routes/drivers.js');
  report('The upload route refuses non-camera files and repeated photos, and saves the fingerprint', /isJpeg\(req\.file\.buffer\)/.test(dr) && /already used for another document/.test(dr) && (dr.match(/fileHash,/g) || []).length >= 3 && /fileHash/.test(rd('prisma/schema.prisma')) && /ADD COLUMN IF NOT EXISTS "fileHash"/.test(rd('prisma/migrations/20261114_document_file_hash/migration.sql')));
  delete process.env.STRICT_DRIVER_APPROVAL; process.env.NODE_ENV = 'development';
  report('Strict approval is ON by default, even in development, and only the exact word false turns it off', app.strictApproval() === true && (process.env.STRICT_DRIVER_APPROVAL = 'false', app.strictApproval()) === false && (process.env.STRICT_DRIVER_APPROVAL = 'true', app.strictApproval()) === true && (delete process.env.STRICT_DRIVER_APPROVAL, true));
  const adminSrc = rd('routes/admin.js');
  report('Only an ADMIN can approve a driver (support can review but not approve)', /'\/admin\/drivers\/:driverId\/approve', requireRole\('ADMIN'\)/.test(adminSrc) && /approvalGate\(driverId, req\.user\.id\)/.test(adminSrc));
  db.kycs[0].checklistBy = 'ADMIN1'; { const all = {}; app.CHECKLIST.forEach(([k]) => { all[k] = true; }); db.kycs[0].checklist = all; db.kycs[0].submittedAt = new Date(); driver.documents = app.REQUIRED_DOCS.map((type) => ({ type, status: 'PENDING' })); driver.liveness = [{ status: 'PENDING_REVIEW', submittedAt: new Date() }]; }
  report('With every item ticked, approval is allowed', (await app.approvalGate('D1', 'ADMIN2')).ok === true);
  process.env.REQUIRE_TWO_PERSON_APPROVAL = 'true';
  const same = await app.approvalGate('D1', 'ADMIN1'), other = await app.approvalGate('D1', 'ADMIN2');
  report('Two-person rule: the admin who ticked the checklist cannot approve, a second admin can', same.ok === false && same.missing.some((m) => /second admin/i.test(m)) && other.ok === true);
  delete process.env.REQUIRE_TWO_PERSON_APPROVAL;

  console.log('\n--- Malawi only ---');
  const loc = require('../services/location');
  report('Lilongwe, Blantyre and Mzuzu are inside Malawi', loc.isInsideMalawi(-13.96, 33.78) && loc.isInsideMalawi(-15.78, 35.0) && loc.isInsideMalawi(-11.46, 34.02));
  report('Hyderabad, Lusaka, Dar es Salaam and Johannesburg are outside, and bad numbers are refused', !loc.isInsideMalawi(17.38, 78.48) && !loc.isInsideMalawi(-15.4, 28.3) && !loc.isInsideMalawi(-6.8, 39.28) && !loc.isInsideMalawi(-26.2, 28.0) && !loc.isInsideMalawi(NaN, 33) && !loc.isInsideMalawi(undefined, undefined));
  report('In production the server refuses a driver location outside Malawi, and the apps use the same limits', /NODE_ENV === 'production' && !locationService\.isInsideMalawi/.test(rd('sockets/tripHandlers.js')) && /minLat: -17\.5, maxLat: -9\.0, minLng: 32\.5, maxLng: 36\.0/.test(rd('rider/next/js/map.js')));
  report('The development test location only exists when the server is in development mode', /allowLocationSimulation/.test(rd('rider/next/js/map.js')) && /return true;\s*\n?\s*var b = AR\.map\.MALAWI|\(AR\.state\.cfg && AR\.state\.cfg\.allowLocationSimulation\)\) return true/.test(rd('rider/next/js/map.js')));

  console.log(`\n   DRIVER APPLICATION RESULTS: ${passed}/${total} TESTS PASSED`);
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('crashed', e); process.exit(1); });
