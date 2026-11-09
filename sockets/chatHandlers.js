const { z } = require('zod');
const prisma = require('../lib/prisma');
const dbLedger = require('../services/dbLedger');
const notificationService = require('../services/notifications');
const { emitToOps, emitToUser } = require('./emitters');
const { sosPayloadSchema, triggerSos } = require('../services/sos');

const socketChatSendSchema = z.object({
  tripId: z.string().min(1, 'tripId is required'),
  text: z.string().min(1, 'message text required').max(2000, 'message too long'),
  sender: z.string().optional(),
  clientId: z.string().max(64).optional()
});

const socketSosTriggerSchema = sosPayloadSchema;

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
  // Simple spam limit per connection: at most 20 chat messages in any 10 seconds.
  const chatSentAt = [];

  // 1. Real-Time Chat: only the rider and the assigned driver of an ACTIVE trip
  socket.on('chat:send', async (msg = {}, callback) => {
    try {
      const nowMs = Date.now();
      while (chatSentAt.length && nowMs - chatSentAt[0] > 10000) chatSentAt.shift();
      if (chatSentAt.length >= 20) throw new Error('You are sending messages too fast. Please wait a moment.');
      chatSentAt.push(nowMs);

      const parsed = socketChatSendSchema.safeParse(msg);
      if (!parsed.success) throw new Error('tripId and text required');
      const text = parsed.data.text.trim().slice(0, 1000);
      if (!text) throw new Error('Message cannot be empty');

      const trip = await prisma.trip.findUnique({
        where: { id: parsed.data.tripId },
        select: { id: true, status: true, riderId: true, driver: { select: { userId: true } } }
      });
      if (!trip) throw new Error('Trip not found');

      const driverUserId = trip.driver?.userId || null;
      const isRider = socket.userId === trip.riderId;
      if (!isRider && socket.userId !== driverUserId) {
        throw new Error('Forbidden: you are not part of this trip');
      }
      if (!['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'].includes(trip.status)) {
        throw new Error('Chat is only available while a driver is assigned to an active trip');
      }

      const saved = await prisma.chatMessage.create({
        data: {
          tripId: trip.id,
          senderId: socket.userId,
          senderRole: isRider ? 'RIDER' : 'DRIVER',
          text
        }
      });

      const messageObj = {
        id: saved && saved.id ? saved.id : null,
        clientId: parsed.data.clientId || null,
        createdAt: (saved && saved.createdAt) || new Date(),
        tripId: trip.id,
        sender: isRider ? 'rider' : 'driver',
        text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      // Delivered ONLY to the two people on this trip, never broadcast.
      emitToUser(io, trip.riderId, 'chat:message', messageObj);
      if (driverUserId) emitToUser(io, driverUserId, 'chat:message', messageObj);
      if (typeof callback === 'function') callback({ success: true, message: messageObj });
    } catch (err) {
      console.warn('[Chat] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 2. SOS Emergency Alert Trigger (the same service also backs the HTTP route /api/sos)
  socket.on('sos:trigger', async (data = {}, callback) => {
    try {
      const parsed = socketSosTriggerSchema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid SOS payload');

      const result = await triggerSos({
        userId: socket.userId,
        role: socket.userRole,
        driverId: socket.driverId,
        data: parsed.data,
        io
      });
      if (typeof callback === 'function') {
        callback(result.duplicate
          ? { success: true, duplicate: true, alert: result.alert }
          : { success: true, alert: result.alert });
      }
    } catch (err) {
      console.error('[SosTrigger] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 3. SOS Resolution (operations staff only)
  socket.on('sos:resolve', async (id, callback) => {
    try {
      if (socket.userRole !== 'ADMIN' && socket.userRole !== 'SUPPORT') {
        throw new Error('Forbidden: Only operations personnel can resolve emergency alerts');
      }
      if (typeof id !== 'string' || !id) throw new Error('SOS incident id required');

      const updated = await prisma.sosEvent.updateMany({
        where: { id, status: { in: ['ACTIVE', 'ESCALATED_POLICE'] } },
        data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: socket.userId }
      });
      if (updated.count === 0) throw new Error('SOS incident not found or already resolved');

      await prisma.auditLog.create({
        data: { userId: socket.userId, action: 'SOS_RESOLVED', entityType: 'SOS', entityId: id, details: {} }
      }).catch((e) => console.warn('[SosResolve] Audit log failed:', e.message));

      emitToOps(io, 'sos:resolved', id);
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
  socket.on('call:signal', async (signal = {}) => {
    try {
      if (!signal || typeof signal.tripId !== 'string') return;
      if (JSON.stringify(signal.data || {}).length > 10000) return;

      const trip = await prisma.trip.findUnique({
        where: { id: signal.tripId },
        select: { riderId: true, status: true, driver: { select: { userId: true } } }
      });
      if (!trip || !['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'].includes(trip.status)) return;

      const driverUserId = trip.driver?.userId || null;
      let target = null;
      if (socket.userId === trip.riderId) target = driverUserId;
      else if (socket.userId === driverUserId) target = trip.riderId;
      if (!target) return;

      emitToUser(io, target, 'call:signal', { tripId: signal.tripId, data: signal.data });
    } catch (err) {
      console.warn('[CallSignal] Error:', err.message);
    }
  });
}

module.exports = registerChatHandlers;
