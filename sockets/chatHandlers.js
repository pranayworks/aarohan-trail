const { z } = require('zod');
const prisma = require('../lib/prisma');
const dbLedger = require('../services/dbLedger');
const notificationService = require('../services/notifications');

const socketChatSendSchema = z.object({
  tripId: z.string().min(1, 'tripId is required'),
  text: z.string().min(1, 'message text required'),
  sender: z.string().optional()
});

const socketSosTriggerSchema = z.object({
  tripId: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  note: z.string().optional(),
  location: z.string().optional(),
  source: z.string().optional(),
  riderPhone: z.string().optional(),
  emergencyPhone: z.string().optional()
});

const socketWalletTopupSchema = z.object({
  amount: z.number().int().positive('Top-up amount must be positive'),
  provider: z.string().optional(),
  idempotencyKey: z.string().optional()
});

const socketWalletTransferSchema = z.object({
  amount: z.number().int().positive('Transfer amount must be positive'),
  recipientId: z.string().optional(),
  phone: z.string().optional(),
  idempotencyKey: z.string().optional()
});

function registerChatHandlers(io, socket, operationalState) {
  // 1. Real-Time Chat
  socket.on('chat:send', async (msg = {}, callback) => {
    try {
      const parsed = socketChatSendSchema.safeParse(msg);
      if (!parsed.success) throw new Error('tripId and text required');

      await prisma.chatMessage.create({
        data: {
          tripId: parsed.data.tripId,
          senderId: socket.userId,
          senderRole: socket.userRole || 'RIDER',
          text: parsed.data.text
        }
      });

      const messageObj = {
        tripId: parsed.data.tripId,
        sender: socket.userRole?.toLowerCase() || 'rider',
        text: parsed.data.text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      io.to(`trip:${parsed.data.tripId}`).emit('chat:message', messageObj);
      io.emit('chat:message', messageObj);
      if (typeof callback === 'function') callback({ success: true, message: messageObj });
    } catch (err) {
      console.warn('[Chat] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 2. SOS Emergency Alert Trigger
  socket.on('sos:trigger', async (data = {}, callback) => {
    try {
      const parsed = socketSosTriggerSchema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid SOS payload');

      let validTripId = null;
      if (parsed.data.tripId) {
        const tripExists = await prisma.trip.findUnique({ where: { id: parsed.data.tripId } });
        if (tripExists) validTripId = parsed.data.tripId;
      }

      const sosEvent = await prisma.sosEvent.create({
        data: {
          tripId: validTripId,
          userId: socket.userId,
          lat: parsed.data.lat || -13.9722,
          lng: parsed.data.lng || 33.7667,
          notes: parsed.data.note || 'Emergency assistance requested on corridor',
          status: 'ACTIVE'
        }
      });

      const alertItem = {
        id: sosEvent.id,
        source: socket.userRole || 'RIDER',
        location: parsed.data.location || 'Kenyatta Drive, Lilongwe',
        lat: sosEvent.lat,
        lng: sosEvent.lng,
        riderPhone: socket.user?.phone || '+265991234567',
        emergencyPhone: parsed.data.emergencyPhone || '+265999970000',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'ACTIVE_DISPATCH_ALERT',
        note: parsed.data.note || 'Emergency assistance requested on corridor'
      };

      io.emit('sos:alert', alertItem);
      notificationService.sendEmergencySosAlert(alertItem).catch(err => {
        console.warn('[NotificationService] SOS broadcast exception:', err.message);
      });
      if (typeof callback === 'function') callback({ success: true, alert: alertItem });
    } catch (err) {
      console.error('[SosTrigger] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 3. SOS Resolution
  socket.on('sos:resolve', async (id, callback) => {
    try {
      if (socket.userRole !== 'ADMIN' && socket.userRole !== 'SUPPORT') {
        throw new Error('Forbidden: Only operations personnel can resolve emergency alerts');
      }
      await prisma.sosEvent.update({
        where: { id },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: socket.userId }
      });
      io.emit('sos:resolved', id);
      if (typeof callback === 'function') callback({ success: true });
    } catch (err) {
      console.warn('[SosResolve] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 4. Dynamic Surge Multiplier Update
  socket.on('surge:update', (data, callback) => {
    try {
      if (socket.userRole !== 'ADMIN') {
        throw new Error('Forbidden: Only administrators can update surge multipliers');
      }
      if (data && data.zone && operationalState?.surgeMultipliers) {
        operationalState.surgeMultipliers[data.zone] = parseFloat(data.multiplier);
        io.emit('surge:updated', data);
        if (typeof callback === 'function') callback({ success: true });
      }
    } catch (err) {
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 5. Rider Wallet Top Up
  socket.on('wallet:topup', async (data = {}, callback) => {
    try {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Direct wallet top-up is disabled in production. Real payment provider integration required.');
      }

      const parsed = socketWalletTopupSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'Invalid wallet topup data');
      }

      const user = await prisma.user.findUnique({
        where: { id: socket.userId },
        select: { status: true }
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new Error('User account is inactive. Wallet operations blocked.');
      }

      const result = await dbLedger.recordWalletTopup({
        userId: socket.userId,
        amountMWK: parsed.data.amount,
        provider: parsed.data.provider || 'Airtel Money',
        idempotencyKey: parsed.data.idempotencyKey
      });

      socket.emit('wallet:updated', { wallet: result.wallet, netBalanceSum: result.netBalanceSum });
      io.emit('wallet:updated', { userId: socket.userId, wallet: result.wallet });
      if (typeof callback === 'function') callback({ success: true, wallet: result.wallet });
    } catch (err) {
      socket.emit('wallet:error', { error: err.message });
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 6. P2P Transfer
  socket.on('wallet:transfer', async (data = {}, callback) => {
    try {
      const parsed = socketWalletTransferSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'Invalid wallet transfer data');
      }

      const user = await prisma.user.findUnique({
        where: { id: socket.userId },
        select: { status: true }
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new Error('User account is inactive. Wallet operations blocked.');
      }

      let recipientUserId = parsed.data.recipientId;
      if (!recipientUserId && parsed.data.phone) {
        const recipient = await prisma.user.findUnique({ where: { phone: parsed.data.phone } });
        if (recipient) recipientUserId = recipient.id;
      }
      if (!recipientUserId) throw new Error('Recipient not found');

      const result = await dbLedger.recordP2PTransfer({
        senderUserId: socket.userId,
        recipientUserId,
        amountMWK: parsed.data.amount,
        idempotencyKey: parsed.data.idempotencyKey
      });

      socket.emit('wallet:updated', { wallet: result.senderWallet, netBalanceSum: result.netBalanceSum });
      if (typeof callback === 'function') callback({ success: true, wallet: result.senderWallet });
    } catch (err) {
      socket.emit('wallet:error', { error: err.message });
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 7. In-App Call Signaling
  socket.on('call:signal', (signal) => {
    try {
      socket.broadcast.emit('call:signal', signal);
    } catch (err) {
      console.warn('[CallSignal] Error:', err.message);
    }
  });
}

module.exports = registerChatHandlers;
