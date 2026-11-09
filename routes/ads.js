// ============================================================================
// ADS: what the rider app and the driver app show, and the admin tools to manage them.
//   Apps:  GET /api/ads?audience=RIDER|DRIVER     POST /api/ads/:id/event {type: impression|click}
//   Admin: GET/POST /api/admin/ads   PATCH/DELETE /api/admin/ads/:id   (ADMIN only)
// ============================================================================
const express = require('express');
const multer = require('multer');
const { requireRole } = require('../middleware/auth');
const ads = require('../services/adService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const fail = (res, e) => res.status(e instanceof ads.AdError ? e.status : 500).json({ error: e.message });
const needLogin = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Authentication required' }));

router.get('/ads', needLogin, async (req, res) => {
  try { res.json({ success: true, ads: await ads.listForApp(String(req.query.audience || '').toUpperCase(), { placement: req.query.placement, lat: req.query.lat, lng: req.query.lng }) }); } catch (e) { fail(res, e); }
});
router.get('/admin/ads/placements', requireRole('ADMIN'), (req, res) => res.json({ success: true, placements: ads.PLACEMENTS }));
router.post('/ads/:id/event', needLogin, async (req, res) => {
  try { await ads.track(req.params.id, req.body && req.body.type); res.json({ success: true }); } catch (e) { fail(res, e); }
});

router.get('/admin/ads', requireRole('ADMIN'), async (req, res) => {
  try { res.json({ success: true, ads: await ads.adminList(String(req.query.audience || '').toUpperCase()) }); } catch (e) { fail(res, e); }
});
router.post('/admin/ads', requireRole('ADMIN'), (req, res, next) => upload.single('media')(req, res, (err) => (err ? res.status(400).json({ error: 'The file is too big (pictures 5 MB, videos 25 MB).' }) : next())), async (req, res) => {
  try { const ad = await ads.create(req.body || {}, req.file, req.user.id, req.ip); res.json({ success: true, ad }); } catch (e) { fail(res, e); }
});
router.patch('/admin/ads/:id', requireRole('ADMIN'), async (req, res) => {
  try { res.json({ success: true, ad: await ads.update(req.params.id, req.body || {}, req.user.id, req.ip) }); } catch (e) { fail(res, e); }
});
router.delete('/admin/ads/:id', requireRole('ADMIN'), async (req, res) => {
  try { await ads.remove(req.params.id, req.user.id, req.ip); res.json({ success: true }); } catch (e) { fail(res, e); }
});

module.exports = router;
