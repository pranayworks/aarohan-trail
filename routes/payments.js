const express = require('express');
const { z } = require('zod');
const paymentManager = require('../services/payments');
const { validateBody } = require('../middleware/auth');

const router = express.Router();

const restPaymentInitiateSchema = z.object({
  amount: z.number().int().positive('Amount must be positive'),
  currency: z.string().optional(),
  phone: z.string().min(9, 'Phone is required'),
  reference: z.string().optional(),
  provider: z.string().optional(),
  idempotencyKey: z.string().optional()
});

router.post('/payments/initiate', validateBody(restPaymentInitiateSchema), async (req, res) => {
  try {
    const { amount, currency, phone, reference, provider, idempotencyKey } = req.body;
    const adapter = paymentManager.getAdapter(provider || 'sandbox');
    const result = await adapter.initiateCollection({
      amount,
      currency: currency || 'MWK',
      phone,
      reference,
      idempotencyKey
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/payments/verify/:reference', async (req, res) => {
  try {
    const provider = req.query.provider || 'sandbox';
    const adapter = paymentManager.getAdapter(provider);
    const result = await adapter.verifyPayment(req.params.reference);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/payments/webhook/:provider', async (req, res) => {
  try {
    const adapter = paymentManager.getAdapter(req.params.provider);
    const signature = req.headers['x-webhook-signature'] || req.headers['authorization'];
    const result = await adapter.handleWebhook(req.body, signature);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
