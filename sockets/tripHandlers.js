const { z } = require('zod');
const prisma = require('../lib/prisma');
const dbLedger = require('../services/dbLedger');
const pricingService = require('../services/pricing');

const socketTripRequestSchema = z.object({
  quoteId: z.string().optional(),
  fare: z.number().optional(),
  baseFare: z.number().optional(),
  tierId: z.string().optional(),
  pickup: z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      address: z.string().optional(),
      lat: z.number(),
      lng: z.number()
    })
  ]),
  destination: z.union([
    z.string(),
    z.object({
      name: z.string().optional(),
      address: z.string().optional(),
      lat: z.number(),
      lng: z.number()
    })
  ]),
  distanceKm: z.number().optional(),
  durationMins: z.number().optional(),
  idempotencyKey: z.string().optional(),
  paymentMethod: z.string().optional()
});

const socketTripAcceptSchema = z.object({
  tripId: z.string().min(1, 'tripId is required')
});

const socketDriverMovedSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  heading: z.number().optional(),
  accuracy: z.number().optional(),
  speed: z.number().optional()
});

const socketTripArrivedSchema = z.object({
  tripId: z.string().min(1, 'tripId is required')
});

const socketTripStartTransitSchema = z.object({
  tripId: z.string().min(1, 'tripId is required'),
  pin: z.string().min(4).max(6, 'PIN must be 4 digits')
});

const socketTripCompleteSchema = z.object({
  tripId: z.string().min(1, 'tripId is required'),
  paymentMethod: z.string().optional(),
  driverTip: z.number().optional()
});

const socketTripRateSchema = z.object({
  tripId: z.string().min(1, 'tripId is required'),
  rating: z.union([z.number(), z.string()]).optional(),
  tags: z.array(z.string()).optional(),
  comment: z.string().optional()
});

const socketTripCancelSchema = z.union([
  z.string().min(1),
  z.object({
    tripId: z.string().min(1),
    reason: z.string().optional()
  })
]);

const socketDriverSetStatusSchema = z.object({
  status: z.enum(['ONLINE', 'OFFLINE', 'BUSY'])
});

function registerTripHandlers(io, socket) {
  // 1. Trip Request from Rider App
  socket.on('trip:request', async (data = {}, callback) => {
    try {
      const parsed = socketTripRequestSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'Invalid trip request payload');
      }
      const reqData = parsed.data;

      const user = await prisma.user.findUnique({ where: { id: socket.userId }, select: { status: true } });
      if (!user || user.status !== 'ACTIVE') {
        throw new Error('Account inactive. Cannot request trips.');
      }

      let fare = Math.round(reqData.fare || 1500);
      let baseFare = Math.round(reqData.baseFare || fare);
      let distanceKm = parseFloat(reqData.distanceKm) || 3.5;
      let durationMins = parseInt(reqData.durationMins, 10) || 8;

      if (reqData.quoteId) {
        try {
          const selectedTier = (reqData.tierId || 'moto').toLowerCase();
          const consumed = pricingService.validateAndConsumeQuote(reqData.quoteId, selectedTier);
          fare = consumed.tier.finalFare;
          baseFare = consumed.tier.baseFare;
          distanceKm = consumed.distanceKm;
          durationMins = consumed.durationMins;
        } catch (quoteErr) {
          throw new Error(quoteErr.message);
        }
      }

      const commission = Math.round(fare * 0.30);
      const driverShare = fare - commission;
      const pin = Math.floor(1000 + Math.random() * 9000).toString();

      const trip = await prisma.$transaction(async (tx) => {
        const created = await tx.trip.create({
          data: {
            riderId: socket.userId,
            status: 'REQUESTED',
            tier: (reqData.tierId || 'moto').toUpperCase(),
            pickupAddress: (typeof reqData.pickup === 'string') ? reqData.pickup : (reqData.pickup?.name || reqData.pickup?.address || 'Pickup Point'),
            dropoffAddress: (typeof reqData.destination === 'string') ? reqData.destination : (reqData.destination?.name || reqData.destination?.address || 'Destination'),
            pickupLat: typeof reqData.pickup === 'object' ? reqData.pickup.lat : -13.9722,
            pickupLng: typeof reqData.pickup === 'object' ? reqData.pickup.lng : 33.7667,
            dropoffLat: typeof reqData.destination === 'object' ? reqData.destination.lat : -13.9933,
            dropoffLng: typeof reqData.destination === 'object' ? reqData.destination.lng : 33.6777,
            distanceKm: distanceKm,
            durationMins: durationMins,
            fareMWK: fare,
            baseFareMWK: baseFare,
            bookingFeeMWK: 150,
            driverShareMWK: driverShare,
            commissionMWK: commission,
            pin: pin,
            idempotencyKey: reqData.idempotencyKey || `REQ-${socket.userId}-${Date.now()}`,
            paymentMethod: (reqData.paymentMethod && reqData.paymentMethod.toUpperCase().includes('CASH')) ? 'CASH' : 'WALLET_ESCROW'
          },
          include: {
            rider: { select: { id: true, name: true, phone: true } }
          }
        });

        await tx.tripStatusHistory.create({
          data: {
            tripId: created.id,
            fromStatus: null,
            status: 'REQUESTED',
            changedBy: socket.userId,
            reason: 'Rider initiated booking'
          }
        });

        return created;
      }, { maxWait: 10000, timeout: 30000 });

      socket.join(`trip:${trip.id}`);
      io.emit('trip:requested', trip);
      if (typeof callback === 'function') callback({ success: true, trip });
    } catch (err) {
      console.warn('[TripRequest] Error:', err.message);
      const isDuplicateActive = err.code === 'P2002' || err.message.includes('unique_active_trip_per_rider');
      const errorMsg = isDuplicateActive
        ? 'Rider already has an active trip'
        : (err.message || 'Failed to request trip');
      socket.emit('trip:error', { error: errorMsg, code: err.code });
      if (typeof callback === 'function') callback({ success: false, error: errorMsg });
    }
  });

  // 2. Driver Accepts Trip
  socket.on('trip:accept', async (data = {}, callback) => {
    try {
      const parsed = socketTripAcceptSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'tripId is required');
      }
      const tripId = parsed.data.tripId;

      if (socket.userRole !== 'DRIVER' || !socket.driverId) {
        throw new Error('Unauthorized: Only registered drivers can accept trips');
      }

      const updatedTrip = await prisma.$transaction(async (tx) => {
        const driverRecord = await tx.driver.findFirst({
          where: {
            id: socket.driverId,
            approvalStatus: 'APPROVED',
            user: { id: socket.userId, status: 'ACTIVE' }
          }
        });

        if (!driverRecord) {
          throw new Error('Driver account is not active or approved');
        }

        const trip = await tx.trip.findUnique({
          where: { id: tripId }
        });

        if (!trip) throw new Error('Trip not found');
        if (trip.status !== 'REQUESTED' && trip.status !== 'OFFERED') {
          throw new Error('Trip is no longer available');
        }
        if (trip.driverId) {
          throw new Error('Trip already accepted by another driver');
        }

        const updateResult = await tx.trip.updateMany({
          where: {
            id: tripId,
            status: { in: ['REQUESTED', 'OFFERED'] },
            driverId: null
          },
          data: {
            driverId: socket.driverId,
            status: 'DRIVER_ARRIVING',
            acceptedAt: new Date()
          }
        });

        if (updateResult.count === 0) {
          throw new Error('Trip already accepted by another driver');
        }

        const accepted = await tx.trip.findUnique({
          where: { id: tripId },
          include: {
            rider: { select: { id: true, name: true, phone: true } },
            driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } }
          }
        });

        await tx.tripStatusHistory.create({
          data: {
            tripId: accepted.id,
            fromStatus: trip.status,
            status: 'DRIVER_ARRIVING',
            changedBy: socket.userId,
            reason: 'Driver accepted ride offer'
          }
        });

        return accepted;
      }, { maxWait: 10000, timeout: 30000 });

      socket.join(`trip:${updatedTrip.id}`);
      io.to(`trip:${updatedTrip.id}`).emit('trip:accepted', { trip: updatedTrip, driver: updatedTrip.driver });
      io.emit('trip:accepted', { trip: updatedTrip, driver: updatedTrip.driver });
      if (typeof callback === 'function') callback({ success: true, trip: updatedTrip });
    } catch (err) {
      console.warn('[TripAccept] Error:', err.message);
      const isDuplicateDriver = err.code === 'P2002' || err.message.includes('already accepted');
      const errorMsg = isDuplicateDriver
        ? 'Trip already accepted by another driver'
        : (err.message || 'Failed to accept trip');
      socket.emit('trip:error', { error: errorMsg, code: err.code });
      if (typeof callback === 'function') callback({ success: false, error: errorMsg });
    }
  });

  // 3. Driver Availability Status
  socket.on('driver:set_status', async (data = {}, callback) => {
    try {
      if (socket.userRole !== 'DRIVER' || !socket.driverId) {
        throw new Error('Only registered drivers can change driver availability');
      }
      const parsed = socketDriverSetStatusSchema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid availability status');

      const driver = await prisma.driver.findFirst({
        where: {
          id: socket.driverId,
          approvalStatus: 'APPROVED',
          user: { id: socket.userId, status: 'ACTIVE' }
        }
      });

      if (!driver) {
        throw new Error('Driver profile is not active and approved');
      }

      const updated = await prisma.driver.update({
        where: { id: socket.driverId },
        data: { availability: parsed.data.status }
      });

      socket.emit('driver:status_changed', { availability: updated.availability });
      if (typeof callback === 'function') callback({ success: true, availability: updated.availability });
    } catch (err) {
      socket.emit('driver:error', { error: err.message });
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 4. Driver Live GPS Telemetry
  socket.on('trip:driver_moved', async (coords) => {
    try {
      if (!socket.driverId) return;
      const parsed = socketDriverMovedSchema.safeParse(coords);
      if (!parsed.success) return;

      await prisma.driver.updateMany({
        where: { id: socket.driverId, approvalStatus: 'APPROVED' },
        data: {
          currentLat: parsed.data.lat,
          currentLng: parsed.data.lng,
          currentHeading: parsed.data.heading || null,
          lastLocationAt: new Date()
        }
      });
      socket.broadcast.emit('trip:driver_moved', { ...parsed.data, driverId: socket.driverId });
    } catch (err) {
      console.warn('[DriverMoved] Error:', err.message);
    }
  });

  // 5. Driver Arrived at Pickup
  socket.on('trip:arrived', async (data = {}, callback) => {
    try {
      const parsed = socketTripArrivedSchema.safeParse(data);
      if (!parsed.success) throw new Error('tripId is required');
      const tripId = parsed.data.tripId;

      const trip = await prisma.trip.findFirst({
        where: { id: tripId, status: 'DRIVER_ARRIVING' },
        include: { driver: true }
      });

      if (!trip) throw new Error('Active arriving trip not found');
      if (socket.driverId && trip.driverId !== socket.driverId && trip.driver?.userId !== socket.userId) {
        throw new Error('Unauthorized: Driver does not own this trip');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const t = await tx.trip.update({
          where: { id: trip.id },
          data: { status: 'ARRIVED', arrivedAt: new Date() },
          include: { rider: true, driver: { include: { user: true, vehicle: true } } }
        });
        await tx.tripStatusHistory.create({
          data: {
            tripId: t.id,
            fromStatus: trip.status,
            status: 'ARRIVED',
            changedBy: socket.userId,
            reason: 'Driver arrived at pickup location'
          }
        });
        return t;
      }, { maxWait: 10000, timeout: 30000 });

      io.to(`trip:${updated.id}`).emit('trip:arrived', updated);
      io.emit('trip:arrived', updated);
      if (typeof callback === 'function') callback({ success: true, trip: updated });
    } catch (err) {
      socket.emit('trip:error', { error: err.message });
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 6. Trip In Transit (PIN Verification)
  socket.on('trip:start_transit', async (data = {}, callback) => {
    try {
      const parsed = socketTripStartTransitSchema.safeParse(data);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'tripId and 4-digit PIN required');
      const { tripId, pin } = parsed.data;

      const trip = await prisma.trip.findFirst({
        where: { id: tripId, status: 'ARRIVED' },
        include: { driver: true }
      });

      if (!trip) throw new Error('Arrived trip not found');
      if (socket.driverId && trip.driverId !== socket.driverId && trip.driver?.userId !== socket.userId) {
        throw new Error('Unauthorized: Driver does not own this trip');
      }

      if (trip.pinAttempts >= 5) {
        throw new Error('PIN entry locked: Maximum attempts (5) exceeded');
      }

      if (pin !== trip.pin) {
        await prisma.trip.update({
          where: { id: trip.id },
          data: { pinAttempts: { increment: 1 } }
        });
        throw new Error('Invalid passenger safety PIN');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const t = await tx.trip.update({
          where: { id: trip.id },
          data: { status: 'IN_TRANSIT', startedAt: new Date() },
          include: { rider: true, driver: { include: { user: true, vehicle: true } } }
        });
        await tx.tripStatusHistory.create({
          data: {
            tripId: t.id,
            fromStatus: trip.status,
            status: 'IN_TRANSIT',
            changedBy: socket.userId,
            reason: 'Passenger PIN verified, transit started'
          }
        });
        return t;
      }, { maxWait: 10000, timeout: 30000 });

      io.to(`trip:${updated.id}`).emit('trip:in_transit', updated);
      io.emit('trip:in_transit', updated);
      if (typeof callback === 'function') callback({ success: true, trip: updated });
    } catch (err) {
      socket.emit('trip:error', { error: err.message });
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 7. Trip Completed
  socket.on('trip:complete', async (completionData = {}, callback) => {
    try {
      const parsed = socketTripCompleteSchema.safeParse(completionData);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'tripId is required');
      const { tripId } = parsed.data;

      const trip = await prisma.trip.findFirst({
        where: { id: tripId, status: 'IN_TRANSIT' },
        include: { driver: true, rider: true }
      });

      if (!trip) throw new Error('In-transit trip not found');
      if (socket.driverId && trip.driverId !== socket.driverId && trip.driver?.userId !== socket.userId) {
        throw new Error('Unauthorized: Driver does not own this trip');
      }

      const paymentMethod = completionData.paymentMethod || trip.paymentMethod || 'CASH';
      const driverTip = completionData.driverTip || trip.driverTipMWK || 0;

      const settleResult = await dbLedger.settleRide({
        tripId: trip.id,
        paymentMethod,
        driverTipMWK: driverTip,
        changedBy: socket.userId
      });

      io.to(`trip:${trip.id}`).emit('trip:completed', {
        trip: settleResult.trip,
        journalId: settleResult.journalId,
        netBalanceSum: settleResult.netBalanceSum,
        breakdown: settleResult.breakdown
      });
      io.emit('trip:completed', {
        trip: settleResult.trip,
        journalId: settleResult.journalId,
        netBalanceSum: settleResult.netBalanceSum,
        breakdown: settleResult.breakdown
      });
      if (typeof callback === 'function') {
        callback({
          success: true,
          trip: settleResult.trip,
          journalId: settleResult.journalId,
          breakdown: settleResult.breakdown
        });
      }
    } catch (err) {
      socket.emit('trip:error', { error: err.message });
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message });
      }
    }
  });

  // 8. Rider Rating & Driver Tip
  socket.on('trip:rate', async (review = {}, callback) => {
    try {
      const parsed = socketTripRateSchema.safeParse(review);
      if (!parsed.success) throw new Error('Invalid rating payload');

      const trip = await prisma.trip.findFirst({
        where: { id: parsed.data.tripId, status: 'COMPLETED' },
        include: { driver: true }
      });

      if (trip && trip.driver?.userId) {
        await prisma.$transaction(async (tx) => {
          await tx.rating.upsert({
            where: {
              tripId_fromUserId: { tripId: trip.id, fromUserId: socket.userId }
            },
            create: {
              tripId: trip.id,
              fromUserId: socket.userId,
              toUserId: trip.driver.userId,
              stars: Math.min(5, Math.max(1, parseInt(parsed.data.rating, 10) || 5)),
              tags: Array.isArray(parsed.data.tags) ? parsed.data.tags : [],
              comment: parsed.data.comment || null
            },
            update: {
              stars: Math.min(5, Math.max(1, parseInt(parsed.data.rating, 10) || 5)),
              comment: parsed.data.comment || null
            }
          });
        });
      }
      io.emit('trip:rated', { review, tripId: trip?.id });
      if (typeof callback === 'function') callback({ success: true });
    } catch (err) {
      console.warn('[TripRate] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  // 9. Trip Cancelled
  socket.on('trip:cancel', async (data = {}, callback) => {
    try {
      const parsed = socketTripCancelSchema.safeParse(data);
      if (!parsed.success) throw new Error('Invalid cancellation data');

      const tripId = typeof data === 'string' ? data : data.tripId;
      const reason = (typeof data === 'object' && data.reason) ? data.reason : 'Cancelled by user';

      const trip = await prisma.trip.findFirst({
        where: tripId ? { id: tripId } : {
          OR: [{ riderId: socket.userId }, { driverId: socket.driverId }],
          status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED'] }
        }
      });

      if (trip) {
        const isRider = trip.riderId === socket.userId;
        const newStatus = isRider ? 'CANCELLED_BY_RIDER' : 'CANCELLED_BY_DRIVER';

        const updated = await prisma.$transaction(async (tx) => {
          const t = await tx.trip.update({
            where: { id: trip.id },
            data: {
              status: newStatus,
              cancelledBy: isRider ? 'RIDER' : 'DRIVER',
              cancelReason: reason,
              cancelledAt: new Date()
            }
          });
          await tx.tripStatusHistory.create({
            data: {
              tripId: t.id,
              fromStatus: trip.status,
              status: newStatus,
              changedBy: socket.userId,
              reason
            }
          });
          return t;
        });

        io.to(`trip:${updated.id}`).emit('trip:cancelled', { tripId: updated.id, status: newStatus, reason });
        io.emit('trip:cancelled', { tripId: updated.id, status: newStatus, reason });
        if (typeof callback === 'function') callback({ success: true, trip: updated });
      }
    } catch (err) {
      console.warn('[TripCancel] Error:', err.message);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });
}

module.exports = registerTripHandlers;
