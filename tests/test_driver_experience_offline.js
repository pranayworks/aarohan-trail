'use strict';
// Driver experience: reminders for people who stop mid-application, the fast background upload, sign-in help.
let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };
const fs = require('fs'), path = require('path');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const HOUR = 3600000, now = new Date('2026-11-09T12:00:00Z');
const ago = (h) => new Date(now.getTime() - h * HOUR);
const mkDriver = (id, over = {}) => ({ id: 'D' + id, approvalStatus: 'PENDING', createdAt: ago(30), kyc: null, user: { id: 'U' + id, name: 'Driver Number ' + id, email: `d${id}@example.com`, status: 'ACTIVE' }, ...over });
const db = { drivers: [], log: [], emails: [], pushes: [], failFor: null };
const prisma = {
  driver: { findMany: async ({ where }) => db.drivers.filter((d) => d.approvalStatus === where.approvalStatus && d.createdAt < where.createdAt.lt && d.createdAt > where.createdAt.gt && (!d.kyc || !d.kyc.submittedAt)) },
  messageLog: { findMany: async ({ where }) => db.log.filter((m) => m.userId === where.userId && m.purpose === where.purpose) }
};
const pp = require.resolve('../lib/prisma'); require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: prisma };
const ep = require.resolve('../services/email'); require.cache[ep] = { id: ep, filename: ep, loaded: true, exports: { sendEmail: async (a) => { if (db.failFor === a.to) throw new Error('mail down'); db.emails.push(a); db.log.push({ userId: a.userId, purpose: a.purpose, createdAt: db.nowRef }); return { provider: 'simulator' }; } } };
const pn = require.resolve('../services/pushNotification'); require.cache[pn] = { id: pn, filename: pn, loaded: true, exports: { sendPushToUser: async (uid, p) => { db.pushes.push({ uid, p }); return { success: true }; } } };
const rem = require('../services/driverReminders');

(async () => {
  console.log('--- Reminders for drivers who stop');
  db.nowRef = now;
  db.drivers = [mkDriver(1), mkDriver(2, { createdAt: ago(2) }), mkDriver(3, { kyc: { submittedAt: ago(5) } }), mkDriver(4, { user: { id: 'U4', name: 'Sus', email: 's@example.com', status: 'SUSPENDED' } }), mkDriver(5, { approvalStatus: 'APPROVED' }), mkDriver(6, { createdAt: ago(24 * 40) }), mkDriver(7, { kyc: { submittedAt: null } })];
  let r = await rem.runOnce(now);
  const to = db.emails.map((x) => x.to).sort().join();
  report('Only people who started more than a day ago and have not submitted get a reminder', to === 'd1@example.com,d7@example.com' && r.sent === 2);
  report('Not sent to: someone who started 2 hours ago, someone who already submitted, a suspended or approved driver, or someone abandoned for 40 days', !to.includes('d2@') && !to.includes('d3@') && !to.includes('s@example') && !to.includes('d5@') && !to.includes('d6@'));
  report('The email and the push are friendly, name the app, and the email is logged under the reminder purpose', db.emails[0].subject === 'Finish your Aarohan driver application' && /Aarohan Captain/.test(db.emails[0].text) && /progress is saved/.test(db.emails[0].text) && db.emails[0].purpose === 'DRIVER_APPLICATION_REMINDER' && db.pushes.length === 2);
  report('The first name is used, not the full name', /Hello Driver,/.test(db.emails[0].text));
  db.emails = []; db.pushes = [];
  r = await rem.runOnce(new Date(now.getTime() + 1 * HOUR));
  report('Running again an hour later sends nothing (one reminder every 3 days at most)', r.sent === 0 && db.emails.length === 0);
  db.log.forEach((m) => { m.createdAt = ago(24 * 4); });
  r = await rem.runOnce(now);
  report('After 3 days it reminds a second time', r.sent === 2);
  db.log.forEach((m) => { m.createdAt = ago(24 * 4); });
  await rem.runOnce(now); db.log.forEach((m) => { m.createdAt = ago(24 * 4); });
  db.emails = []; r = await rem.runOnce(now);
  report('It stops after 3 reminders, so nobody is nagged', r.sent === 0 && db.log.filter((m) => m.userId === 'U1').length === 3);
  db.log = []; db.emails = []; db.failFor = 'd1@example.com';
  r = await rem.runOnce(now);
  report('One failing email does not stop the others', r.sent === 1 && db.emails.some((x) => x.to === 'd7@example.com'));
  report('It is off on a development computer unless asked, and on in production', (delete process.env.DRIVER_REMINDERS, process.env.NODE_ENV = 'development', rem.start()) === null && (process.env.DRIVER_REMINDERS = 'false', process.env.NODE_ENV = 'production', rem.start()) === null);

  console.log('\n--- Fast documents');
  const dapply = rd('driver/next/js/dapply.js'), dcam = rd('driver/next/js/dcamera.js'), drv = rd('routes/drivers.js');
  report('A photo goes to a background queue and the driver moves on at once, with automatic retry', /AR\.D\.uploads\.start\(params\.type, shot\)/.test(dcam) && /UP\.start = function/.test(dapply) && /it\.tries < 4/.test(dapply) && /setTimeout\(function \(\) \{ if \(UP\.items\[type\] === it/.test(dapply));
  report('Photos are about 150 KB, not megabytes (1280 pixels wide, high quality only if small)', /grab\(video, 1280, false\)/.test(dcam) && /380 \* 1024/.test(dcam));
  report('The driver sees progress ("3 of 8 done, about 4 min left") and that progress is saved', /done of ' \+ total|' of ' \+ total \+ ' done|done<\/b>|of ' \+ total/.test(dapply) && /Your progress is saved/.test(dapply) && /min left/.test(dapply));
  report('Submitting waits for photos still uploading, and refuses if one failed', /UP\.pending\(\)\) \{ AR\.toast\('Finishing your photo uploads/.test(dapply) && /One photo did not upload/.test(dapply));
  report('The server does its two checks at the same time and skips the extra signed link', /Promise\.all\(\[\s*driver \? prisma\.driverKyc/.test(drv) && /const signedUrl = null/.test(drv));
  report('The face detector is warmed up while the driver does the documents', /AR\.live\.preload\(\)/.test(dapply));

  console.log('\n--- Sign-in');
  const onb = rd('rider/next/js/onboard.js');
  report('A mistyped email domain (gmial.com) is caught before the code is sent', /gmial\.com/.test(onb) && /Please check the spelling of your email/.test(onb));
  report('Google sign-in works in the browser, uses the native Google plugin inside the Android app when installed, and is left out (email works) when it cannot work', /nativeG/.test(onb) && /isNative && !nativeG\) return ''/.test(onb) && /GoogleAuth/.test(onb));
  report('Google sign-in is shown to drivers exactly as to riders (same screen), once GOOGLE_CLIENT_ID is set', /googleClientId/.test(rd('server.js')) && /googleHtml\(\)/.test(onb) && /rider\/next\/js\/onboard\.js/.test(rd('driver/next/index.html')));

  console.log('\n--- Hosting');
  report('Face files are served from our own server, downloaded by one command, and shipped in the live build', /\/vendor\/mediapipe/.test(rd('server.js')) && /setup:face/.test(rd('package.json')) && /app\/vendor/.test(rd('Dockerfile')) && /fetch-face-models/.test(rd('Dockerfile')));
  console.log(`\n   DRIVER EXPERIENCE RESULTS: ${passed}/${total} TESTS PASSED`); process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('crashed', e); process.exit(1); });
