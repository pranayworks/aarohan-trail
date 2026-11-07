const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { handleSosRequest } = require('../services/sos');

const router = express.Router();

// SOS over HTTP: the backup path used by the apps when the realtime connection is down.
// Requires a valid login; identity and contacts come from the database.
router.post('/sos', requireAuth, handleSosRequest);

module.exports = router;
