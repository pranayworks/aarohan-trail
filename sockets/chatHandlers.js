const { z } = require('zod');
const prisma = require('../lib/prisma');
const dbLedger = require('../services/dbLedger');
const notificationService = require('../services/notifications');
const { emitToOps, emitToUser } = require('./emitters');

const socketChatSendSchema = z.object({
  tripId: z.string().min(1, 'tripId is required'),
  text: z.string().min(1, 'message text required').max(2000, 'message too long'),
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
  // 1. Real-Time Chat: only the rider and the assigned driver of an ACTIVE trip
  socket.on('chat:send', async (msg = {}, callback) => {
    try {
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

      await prisma.chatMessage.create({
        data: {
          tripId: trip.id,
          senderId: socket.userId,
          senderRole: isRider ? 'RIDER' : 'DRIVER',
          text
        }
      });

      const messageObj = {
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

  // 2. SOS Emergency Alert Trigger
  socket.on('sos:trigger', async (data = {}, callback) => {
    try {
      const parsed = socketSosTriggerSchema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid SOS payload');

      // Identity and contacts come from the database, NEVER from the client.
      const me = await prisma.user.findUnique({
        where: { id: socket.userId },
        select: { id: true, name: true, phone: true, emergencyContactName: true, emergencyContactPhone: true }
      });
      if (!me) throw new Error('Account not found');

      const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // One incident per person per minute: a repeated press returns the same incident.
      const recent = await prisma.sosEvent.findFirst({
        where: { userId: me.id, status: 'ACTIVE', createdAt: { gte: new Date(Date.now() - 60 * 1000) } },
        orderBy: { createdAt: 'desc' }
      });
      if (recent) {
        if (typeof callback === 'function') {
          callback({
            success: true,
            duplicate: true,
            alert: {
              id: recent.id,
              source: socket.userRole || 'RIDER',
              lat: recent.lat,
              lng: recent.lng,
              time: nowLabel(),
              status: 'ACTIVE_DISPATCH_ALERT',
              note: recent.notes
            }
          });
        }
        return;
      }

      // Only link a trip the caller really belongs to.
      let trip = null;
      if (parsed.data.tripId) {
        const ownership = [{ riderId: me.id }];
        if (socket.driverId) ownership.push({ driverId: socket.driverId });
        trip = await prisma.trip.findFirst({
          where: { id: parsed.data.tripId, OR: ownership },
          select: {
            id: true,
            pickupLat: true,
            pickupLng: true,
            driver: { select: { user: { select: { name: true, phone: true } } } },
            rider: { select: { name: true, phone: true } }
          }
        });
      }

      const validCoord = (v, limit) => Number.isFinite(v) && Math.abs(v) <= limit;
      let lat = parsed.data.lat;
      let lng = parsed.data.lng;
      let locationKnown = validCoord(lat, 90) && validCoord(lng, 180);
      let approximate = false;
      if (!locationKnown && trip) {
        lat = trip.pickupLat;
        lng = trip.pickupLng;
        locationKnown = true;
        approximate = true;
      }
      if (!locationKnown) {
        lat = -13.9626; // Lilongwe centre, flagged below as unknown
        lng = 33.7873;
      }

      let note = String(parsed.data.note || 'Emergency assistance requested').slice(0, 300);
      if (approximate) note += ' [APPROXIMATE: trip pickup location]';
      if (!locationKnown) note += ' [LOCATION UNKNOWN: no GPS received]';

      const sosEvent = await prisma.sosEvent.create({
        data: { tripId: trip ? trip.id : null, userId: me.id, lat, lng, notes: note, status: 'ACTIVE' }
      });

      await prisma.auditLog.create({
        data: {
          userId: me.id,
          action: 'SOS_TRIGGERED',
          entityType: 'SOS',
          entityId: sosEvent.id,
          details: { tripId: trip ? trip.id : null, locationKnown, approximate }
        }
      }).catch((e) => console.warn('[SosTrigger] Audit log failed:', e.message));

      const alertItem = {
        id: sosEvent.id,
        source: socket.userRole || 'RIDER',
        passenger: me.name || null,
        driver: trip?.driver?.user?.name || null,
        location: parsed.data.location ? String(parsed.data.location).slice(0, 200) : null,
        lat,
        lng,
        locationKnown,
        locationApproximate: approximate,
        riderPhone: me.phone,
        emergencyContactName: me.emergencyContactName || null,
        emergencyPhone: me.emergencyContactPhone || null,
        time: nowLabel(),
        status: 'ACTIVE_DISPATCH_ALERT',
        note
      };

      // Operations staff only: SOS details are never sent to other riders or drivers.
      emitToOps(io, 'sos:alert', alertItem);
      notificationService.sendEmergencySosAlert(alertItem).catch((err) => {
        console.warn('[NotificationService] SOS broadcast exception:', err.message);
      });
      if (typeof callback === 'function') callback({ success: true, alert: alertItem });
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
