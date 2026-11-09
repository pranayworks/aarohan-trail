// Admin: audit trail, messages log, driver earnings. Every number comes from the database.
const express = require('express');
const { requireRole } = require('../middleware/auth');
const data = require('../services/adminData');

const router = express.Router();
const wrap = (fn, ...roles) => [requireRole(...roles), async (req, res) => { try { res.json({ success: true, ...(await fn(req.query)) }); } catch (e) { res.status(500).json({ error: e.message }); } }];

router.get('/admin/audit', ...wrap(data.auditTrail, 'ADMIN'));
router.get('/admin/messages', ...wrap(data.messages, 'ADMIN', 'SUPPORT'));
router.get('/admin/driver-earnings', ...wrap(data.driverEarnings, 'ADMIN', 'FINANCE'));

module.exports = router;
