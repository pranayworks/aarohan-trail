// ============================================================================
// DRIVER APPLICATION ROUTES: details, submit for review, incentives; admin review of identity records.
// Documents themselves are uploaded through the existing POST /api/driver/documents.
// ============================================================================
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireRole, validateBody } = require('../middleware/auth');
const app = require('../services/driverApplication');
const supabaseStorage = require('../services/supabaseStorage');
const multer = require('multer');
const liveness = require('../services/liveness');
const frameUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 5 } });

const router = express.Router();
const fail = (res, err) => {
  if (err instanceof app.ApplyError) return res.status(err.status).json({ error: err.message, field: err.field, missing: err.missing });
  return res.status(500).json({ error: err.message });
};

router.get('/driver/application', async (req, res) => { try { res.json({ success: true, application: await app.getApplication(req.user.id) }); } catch (e) { fail(res, e); } });
router.put('/driver/kyc', async (req, res) => { try { res.json({ success: true, application: await app.saveKyc(req.user.id, req.body || {}, req.ip) }); } catch (e) { fail(res, e); } });
router.post('/driver/application/submit', validateBody(z.object({ declaration: z.boolean() })), async (req, res) => { try { res.json({ success: true, application: await app.submit(req.user.id, req.body.declaration, req.ip) }); } catch (e) { fail(res, e); } });

router.get('/driver/incentives', async (req, res) => {
  try {
    const d = await prisma.driver.findFirst({ where: { userId: req.user.id, approvalStatus: 'APPROVED' }, select: { id: true } });
    if (!d) return res.status(403).json({ error: 'Incentives are for approved drivers.' });
    res.json({ success: true, ...(await app.incentives(d.id)) });
  } catch (e) { fail(res, e); }
});

const driverIdOf = async (req, res) => { const d = await prisma.driver.findFirst({ where: { userId: req.user.id, approvalStatus: 'APPROVED' }, select: { id: true } }); if (!d) { res.status(403).json({ error: 'For approved drivers only.' }); return null; } return d.id; };
router.get('/driver/commission', async (req, res) => { try { const id = await driverIdOf(req, res); if (id) res.json({ success: true, ...(await app.commissionSummary(id)) }); } catch (e) { fail(res, e); } });
router.get('/driver/performance', async (req, res) => { try { const id = await driverIdOf(req, res); if (id) res.json({ success: true, ...(await app.performance(id)) }); } catch (e) { fail(res, e); } });
router.get('/driver/hotspots', async (req, res) => { try { const id = await driverIdOf(req, res); if (id) res.json({ success: true, areas: await app.hotspots() }); } catch (e) { fail(res, e); } });
// The offer that is still open for this captain (used when the app is opened from a push alert, or after a weak-signal reconnect).
router.get('/driver/pending-offer', async (req, res) => {
  try {
    const id = await driverIdOf(req, res); if (!id) return;
    const offer = await prisma.tripOffer.findFirst({ where: { driverId: id, status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!offer) return res.json({ success: true, offer: null });
    const dispatch = require('../services/dispatch');
    const trip = await prisma.trip.findUnique({ where: { id: offer.tripId }, include: { rider: { select: { id: true, name: true } }, stops: { orderBy: { sequence: 'asc' } } } });
    if (!trip || trip.driverId || !['REQUESTED', 'OFFERED'].includes(trip.status)) return res.json({ success: true, offer: null });
    const safe = await dispatch.attachParcelForDriver(dispatch.getDriverSafeTrip(trip));
    if (safe && safe.rider) safe.rider = { ...safe.rider, name: String(safe.rider.name || 'Rider').split(' ')[0] };
    res.json({ success: true, offer, trip: safe });
  } catch (e) { fail(res, e); }
});

// "Why am I not getting trips?": the same conditions the dispatcher uses to pick a driver, checked one by one.
router.get('/driver/readiness', async (req, res) => {
  try {
    const locationService = require('../services/location');
    const d = await prisma.driver.findFirst({ where: { userId: req.user.id }, include: { vehicle: true, user: true } });
    if (!d) return res.status(404).json({ error: 'No driver account.' });
    const fresh = (parseInt(process.env.DRIVER_GPS_FRESH_SECONDS, 10) || (process.env.NODE_ENV === 'production' ? 180 : 86400)) * 1000;
    const ageMs = d.lastLocationAt ? Date.now() - new Date(d.lastLocationAt).getTime() : null;
    const maxDebt = require('../services/commissionLimit').limitMWK();
    const inArea = d.currentLat != null && d.currentLng != null && locationService.isWithinServiceArea(d.currentLat, d.currentLng);
    const type = d.vehicle ? d.vehicle.type : null;
    const checks = [
      { key: 'approved', ok: d.approvalStatus === 'APPROVED', text: d.approvalStatus === 'APPROVED' ? 'Your account is approved' : 'Your account is ' + String(d.approvalStatus).toLowerCase() },
      { key: 'active', ok: d.user.status === 'ACTIVE', text: d.user.status === 'ACTIVE' ? 'Your login is active' : 'Your login is ' + String(d.user.status).toLowerCase() },
      { key: 'online', ok: d.availability === 'ONLINE', text: d.availability === 'ONLINE' ? 'You are online on the server' : 'The server shows you as ' + String(d.availability).toLowerCase() + '. Tap Go online.' },
      { key: 'gps', ok: ageMs != null && ageMs <= fresh, text: ageMs == null ? 'The server has no location from you yet' : (ageMs <= fresh ? 'Your location was updated ' + Math.round(ageMs / 1000) + ' seconds ago' : 'Your last location is too old (' + Math.round(ageMs / 60000) + ' minutes). Keep this screen open.') },
      { key: 'area', ok: inArea, text: inArea ? 'Your location is inside the Lilongwe service area' : 'Your location is outside Lilongwe, so riders there cannot be matched to you. For testing, turn on Test location in Settings.' },
      { key: 'debt', ok: d.commissionDebtMWK < maxDebt, text: d.commissionDebtMWK < maxDebt ? 'Commission owed is under your limit (MK ' + maxDebt.toLocaleString() + ')' : 'You owe MK ' + d.commissionDebtMWK.toLocaleString() + ', which has reached the limit. Pay your commission to get orders again.' }
    ];
    res.json({ success: true, checks, vehicleType: type, allOk: checks.every((c) => c.ok), tip: type ? 'Riders are matched by vehicle type. You drive a ' + type.toLowerCase() + ', so the rider must book ' + type.charAt(0) + type.slice(1).toLowerCase() + '.' : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- live face check: random head turns, frames saved for a human reviewer
const applicantDriver = async (req, res) => {
  const d = await prisma.driver.findFirst({ where: { userId: req.user.id }, select: { id: true, approvalStatus: true } });
  if (!d) { res.status(404).json({ error: 'Start your driver application first.' }); return null; }
  if (d.approvalStatus === 'APPROVED') { res.status(409).json({ error: 'You are already approved.' }); return null; }
  if (d.approvalStatus === 'SUSPENDED') { res.status(403).json({ error: 'Your account is suspended.' }); return null; }
  return d;
};
const liveFail = (res, e) => (e instanceof liveness.LiveError ? res.status(e.status).json({ error: e.message }) : res.status(500).json({ error: e.message }));
router.post('/driver/liveness/start', async (req, res) => {
  try { const d = await applicantDriver(req, res); if (!d) return; res.json({ success: true, ...(await liveness.start(d.id, req.ip, req.headers['user-agent'])) }); } catch (e) { liveFail(res, e); }
});
router.post('/driver/liveness/submit', (req, res, next) => frameUpload.array('frames', 5)(req, res, (err) => (err ? res.status(400).json({ error: 'Each photo must be a camera photo under 2 MB.' }) : next())), async (req, res) => {
  try {
    const d = await applicantDriver(req, res); if (!d) return;
    let metrics = []; try { metrics = JSON.parse(req.body.metrics || '[]'); } catch (_) { return res.status(400).json({ error: 'Invalid face check data.' }); }
    const out = await liveness.submit(d.id, { challengeId: String(req.body.challengeId || ''), frames: (req.files || []).map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, size: f.size })), metrics }, req.ip);
    res.json({ success: true, ...out, application: await app.getApplication(req.user.id) });
  } catch (e) { liveFail(res, e); }
});

router.post('/driver/liveness/alternative', async (req, res) => {
  try { const d = await applicantDriver(req, res); if (!d) return; res.json({ success: true, ...(await liveness.requestAlternative(d.id, req.body && req.body.reason, req.ip)), application: await app.getApplication(req.user.id) }); } catch (e) { liveFail(res, e); }
});

// ---- admin: open the identity record and tick the checklist
router.get('/admin/drivers/:driverId/kyc', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const data = await app.adminKyc(req.params.driverId, { full: req.user.role === 'ADMIN' });
    if (!data) return res.status(404).json({ error: 'Driver not found' });
    if (data.selfiePath) { try { data.selfieUrl = await supabaseStorage.getSignedUrl(data.selfiePath, 900); } catch (_) { data.selfieUrl = null; } }
    delete data.selfiePath;
    if (data.liveness && Array.isArray(data.liveness.framePaths)) {
      const labels = ['straight'].concat((data.liveness.steps || []).map((x) => String(x).toLowerCase()));
      data.liveness.frames = await Promise.all(data.liveness.framePaths.map(async (p, i) => ({ label: labels[i] || ('frame ' + i), url: await supabaseStorage.getSignedUrl(p, 900).catch(() => null) })));
      delete data.liveness.framePaths;
    }
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_DOCUMENTS_VIEWED', entityType: 'DRIVER', entityId: req.params.driverId, details: { part: 'identity record' }, ipAddress: req.ip } }).catch(() => {});
    res.json({ success: true, ...data });
  } catch (e) { fail(res, e); }
});
router.post('/admin/drivers/:driverId/checklist', requireRole('ADMIN', 'SUPPORT'), validateBody(z.object({ items: z.record(z.boolean()) })), async (req, res) => {
  try {
    const checklist = await app.saveChecklist(req.params.driverId, req.user.id, req.body.items);
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_DOCUMENTS_VIEWED', entityType: 'DRIVER', entityId: req.params.driverId, details: { part: 'checklist saved', confirmed: Object.values(checklist).filter(Boolean).length }, ipAddress: req.ip } }).catch(() => {});
    res.json({ success: true, checklist });
  } catch (e) { fail(res, e); }
});

// Admin flags specific documents (or the live face check) as unclear/bad, with a reason for each.
// The driver then sees exactly which items to retake and why, and only has to redo those.
router.post('/admin/drivers/:driverId/request-retake', requireRole('ADMIN', 'SUPPORT'), validateBody(z.object({
  items: z.array(z.object({ type: z.string().min(1).max(40), reason: z.string().trim().min(3).max(300) })).min(1).max(12)
})), async (req, res) => {
  try {
    const { driverId } = req.params;
    const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { user: true } });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    if (driver.approvalStatus === 'APPROVED') return res.status(409).json({ error: 'This driver is already approved.' });
    const now = new Date(), flagged = [];
    for (const it of req.body.items) {
      if (it.type === 'LIVE_FACE') {
        const r = await prisma.driverLiveness.updateMany({ where: { driverId, status: { in: ['PENDING_REVIEW', 'ALTERNATIVE_REQUESTED'] } }, data: { status: 'REJECTED', reviewedBy: req.user.id, reviewedAt: now, rejectionReason: it.reason } });
        if (r.count) flagged.push({ label: 'Live face check', reason: it.reason });
      } else {
        const r = await prisma.driverDocument.updateMany({ where: { driverId, type: it.type }, data: { status: 'REJECTED', rejectionReason: it.reason, reviewedBy: req.user.id, reviewedAt: now } });
        if (r.count) flagged.push({ label: it.type.replace(/_/g, ' ').toLowerCase(), reason: it.reason });
      }
    }
    if (!flagged.length) return res.status(400).json({ error: 'Nothing to flag. Those items were not uploaded.' });
    const summary = 'Please retake: ' + flagged.map((f) => f.label + ' (' + f.reason + ')').join('; ');
    await prisma.driver.update({ where: { id: driverId }, data: { approvalStatus: 'REJECTED', rejectionReason: summary.slice(0, 900), availability: 'OFFLINE' } });
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'DRIVER_REJECTED', entityType: 'DRIVER', entityId: driverId, details: { event: 'RETAKE_REQUESTED', items: flagged, driverName: driver.user && driver.user.name }, ipAddress: req.ip || null } }).catch(() => {});
    const io = req.app.get('io');
    if (io) io.to('ops').to('driver:' + driverId).emit('driver:status_changed', { driverId, approvalStatus: 'REJECTED', reason: summary });
    try { require('../services/pushNotification').sendPushToUser(driver.userId, { title: 'Some photos need to be retaken', body: 'Open Aarohan Captain to see which ones and why.', data: { type: 'DRIVER_REJECTED' } }).catch(() => {}); } catch (_) { /* push is optional */ }
    res.json({ success: true, flagged });
  } catch (e) { fail(res, e); }
});

module.exports = router;
