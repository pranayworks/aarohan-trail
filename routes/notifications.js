const express = require('express');
const { z } = require('zod');
const notificationService = require('../services/notifications');
const { requireRole, validateBody } = require('../middleware/auth');

const router = express.Router();

const restNotificationTestSchema = z.object({
  to: z.string().min(1, 'recipient phone required'),
  message: z.string().min(1, 'message required'),
  channel: z.enum(['SMS', 'WHATSAPP', 'PUSH', 'IN_APP']).optional(),
  urgent: z.boolean().optional()
});

router.get('/notifications/history', requireRole('ADMIN', 'SUPPORT'), (req, res) => {
  res.json({ success: true, history: notificationService.getRecentHistory() });
});

router.post('/notifications/test', requireRole('ADMIN', 'SUPPORT'), validateBody(restNotificationTestSchema), async (req, res) => {
  try {
    const { to, message, channel, urgent } = req.body;
    const result = await notificationService.sendMessage({ to, message, channel, urgent });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
