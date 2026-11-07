// ============================================================================
// NOTIFICATIONS & SMS ROUTER • LILONGWE, MALAWI
// ============================================================================

const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const notificationService = require('../services/notifications');
const { requireRole, validateBody } = require('../middleware/auth');
const prisma = require('../lib/prisma');

const router = express.Router();

// Strict rate limiter for Admin Test SMS (max 5 requests per 15 minutes)
const testSmsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many test SMS dispatches. Maximum 5 requests per 15 minutes.' }
});

const restNotificationTestSchema = z.object({
  to: z.string().min(1, 'Recipient phone required'),
  confirmPhone: z.string().min(1, 'Phone confirmation required'),
  message: z.string().min(1, 'Message text required'),
  channel: z.enum(['SMS', 'WHATSAPP', 'PUSH', 'IN_APP']).optional(),
  urgent: z.boolean().optional()
}).refine((data) => data.to.replace(/[\s-]/g, '').trim() === data.confirmPhone.replace(/[\s-]/g, '').trim(), {
  message: 'Recipient phone number and confirmation phone number must match exactly.',
  path: ['confirmPhone']
});

/**
 * 1. Twilio Status Callback Endpoint
 * Validates X-Twilio-Signature and updates SmsLog delivery status.
 */
router.post('/notifications/twilio-callback', async (req, res) => {
  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    return res.status(403).json({ error: 'Missing X-Twilio-Signature header.' });
  }

  // Construct expected URL (prioritizes PUBLIC_BASE_URL when behind reverse proxy)
  let fullUrl;
  if (process.env.PUBLIC_BASE_URL) {
    const base = process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
    const path = req.originalUrl.split('?')[0];
    fullUrl = `${base}${path.startsWith('/') ? path : '/' + path}`;
  } else {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    fullUrl = `${protocol}://${host}${req.originalUrl.split('?')[0]}`;
  }

  try {
    const result = await notificationService.handleTwilioStatusCallback({
      signature,
      url: fullUrl,
      body: req.body || {}
    });

    // Twilio prefers standard TwiML response or HTTP 200
    res.status(200).type('text/xml').send('<Response></Response>');
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    console.error('[TwilioCallback] Error processing callback:', err);
    res.status(500).json({ error: 'Internal callback processing error' });
  }
});

/**
 * 2. Admin & Support SMS Metrics Panel
 * Delivery rate by prefix (Airtel / TNM), daily caps, and failure codes.
 */
router.get('/notifications/stats', requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const stats = await notificationService.getSmsStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3. Recent Notification History (Diagnostic)
 */
router.get('/notifications/history', requireRole('ADMIN', 'SUPPORT'), (req, res) => {
  res.json({ success: true, history: notificationService.getRecentHistory() });
});

/**
 * 4. Test Notification Dispatch (Strictly ADMIN only, rate-limited, confirmed number)
 */
router.post('/notifications/test',
  requireRole('ADMIN'),
  testSmsLimiter,
  validateBody(restNotificationTestSchema),
  async (req, res) => {
    try {
      const { to, message, channel = 'SMS', urgent } = req.body;
      const cleanTo = to.replace(/[\s-]/g, '').trim();

      const result = await notificationService.sendMessage({
        to: cleanTo,
        message,
        channel,
        urgent
      });

      // AuditLog entry for test dispatch
      await prisma.auditLog.create({
        data: {
          user: { connect: { id: req.user.id } },
          action: 'SMS_TEST_SENT',
          entityType: 'SMS',
          details: {
            phoneMasked: notificationService.constructor ? notificationService.getSenderName() : 'Aarohan',
            targetMasked: cleanTo.slice(0, 6) + '****' + cleanTo.slice(-3),
            channel,
            provider: result.provider
          },
          ipAddress: req.ip
        }
      }).catch(() => {});

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
