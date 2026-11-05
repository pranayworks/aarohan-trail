const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const dbLedger = require('../services/dbLedger');
const pricingService = require('../services/pricing');
const ratingService = require('../services/rating');
const locationService = require('../services/location');
const notificationService = require('../services/notifications');
const { recordLocationPoint } = require('../services/tripRecord');

function hashDeliveryCode(code) {
  return crypto.createHmac('sha256', process.env.OTP_HMAC_SECRET || 'aarohan-otp-delivery-secret-2026')
    .update((code || '').toString().trim())
    .digest('hex');
}

const parcelInputSchema = z.object({
  category: z.string().default('General Parcel'),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE']).default('SMALL'),
  fragile: z.boolean().default(false),
  notes: z.string().optional().nullable(),
  recipientName: z.string().min(1, 'Recipient name is required'),
  recipientPhone: z.string().regex(/^\+265[0-9]{9}$/, 'Recipient phone must be valid Malawi +265 format'),
  prohibitedAccepted: z.boolean().optional()
});

const socketTripRequestSchema = z.object({
  quoteId: z.string().optional(),
  fare: z.number().optional(),
  baseFare: z.number().optional(),
  tierId: z.string().optional(),
  serviceType: z.enum(['RIDE', 'PARCEL']).optional(),
  stops: z.array(z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    lat: z.number(),
    lng: z.number()
  })).max(2).optional(),
  parcelDetail: parcelInputSchema.optional(),
  parcel: parcelInputSchema.optional(),
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
  driverTip: z.number().optional(),
  deliveryCode: z.string().optional(),
  recipientPin: z.string().optional(),
  proofNote: z.string().optional()
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

      const pickupLat = typeof reqData.pickup === 'object' ? reqData.pickup.lat : -13.9722;
      const pickupLng = typeof reqData.pickup === 'object' ? reqData.pickup.lng : 33.7667;
      const dropoffLat = typeof reqData.destination === 'object' ? reqData.destination.lat : -13.9933;
      const dropoffLng = typeof reqData.destination === 'object' ? reqData.destination.lng : 33.6777;

      // Service Area Check (Lilongwe corridor bounding box)
      if (!locationService.isWithinServiceArea(pickupLat, pickupLng)) {
        throw new Error('Pickup location is outside the AArohan Lilongwe service area.');
      }
      if (!locationService.isWithinServiceArea(dropoffLat, dropoffLng)) {
        throw new Error('Destination is outside the AArohan Lilongwe service area.');
      }

      let fare = Math.round(reqData.fare || 1500);
      let baseFare = Math.round(reqData.baseFare || fare);
      let distanceKm = parseFloat(reqData.distanceKm) || 3.5;
      let durationMins = parseInt(reqData.durationMins, 10) || 8;
      let consumed = null;

      if (reqData.quoteId) {
        try {
          const selectedTier = (reqData.tierId || 'moto').toLowerCase();
          consumed = pricingService.validateAndConsumeQuote(reqData.quoteId, selectedTier);
          fare = consumed.tier.finalFare;
          baseFare = consumed.tier.baseFare;
          distanceKm = consumed.distanceKm;
          durationMins = consumed.durationMins;
        } catch (quoteErr) {
          throw new Error(quoteErr.message);
        }
      }

      // Check service area on intermediate stops
      const effectiveStops = (consumed && consumed.stops && consumed.stops.length)
        ? consumed.stops
        : (reqData.stops || []);

      for (let s of effectiveStops) {
        if (!locationService.isWithinServiceArea(s.lat, s.lng)) {
          throw new Error('Intermediate stop is outside the AArohan Lilongwe service area.');
        }
      }

      const serviceType = (consumed && consumed.serviceType) ? consumed.serviceType : (reqData.serviceType || 'RIDE');
      const stopCount = effectiveStops.length;
      const stopFeeMWK = (consumed && consumed.stopFeeMWK !== undefined) ? consumed.stopFeeMWK : (stopCount * 500);

      const commission = Math.round(fare * 0.30);
      const driverShare = fare - commission;
      const pin = Math.floor(1000 + Math.random() * 9000).toString();

      // For parcels: generate 4-digit recipient delivery code
      let deliveryCode = null;
      let deliveryCodeHash = null;
      const parcelDeliveryChannel = (process.env.PARCEL_CODE_DELIVERY || 'sender').toLowerCase(); // 'sms' | 'sender'
      if (serviceType === 'PARCEL') {
        deliveryCode = Math.floor(1000 + Math.random() * 9000).toString();
        deliveryCodeHash = hashDeliveryCode(deliveryCode);

        const parcelRecipientPhone = (reqData.parcelDetail?.recipientPhone || reqData.parcel?.recipientPhone);
        // Simulator logs one-time code in development only
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[DEV PARCEL DELIVERY CODE] Channel: ${parcelDeliveryChannel} | Recipient: ${parcelRecipientPhone || 'N/A'} | Code: ${deliveryCode}`);
        }

        // If sms delivery configured, dispatch SMS to recipient
        if (parcelDeliveryChannel === 'sms' && parcelRecipientPhone) {
          notificationService.sendMessage({
            to: parcelRecipientPhone,
            message: `📦 AArohan Parcel Delivery: Your package is on the way! Give delivery code [ ${deliveryCode} ] to the captain upon arrival to confirm receipt.`,
            channel: 'SMS',
            urgent: true
          }).catch(e => console.warn('[ParcelSMS] Delivery code dispatch warning:', e.message));
        }
      }

      const trip = await prisma.$transaction(async (tx) => {
        const created = await tx.trip.create({
          data: {
            riderId: socket.userId,
            status: 'REQUESTED',
            tier: (reqData.tierId || 'moto').toUpperCase(),
            serviceType,
            stopCount,
            stopFeeMWK,
            pickupAddress: (typeof reqData.pickup === 'string') ? reqData.pickup : (reqData.pickup?.name || reqData.pickup?.address || 'Pickup Point'),
            dropoffAddress: (typeof reqData.destination === 'string') ? reqData.destination : (reqData.destination?.name || reqData.destination?.address || 'Destination'),
            pickupLat,
            pickupLng,
            dropoffLat,
            dropoffLng,
            distanceKm,
            durationMins,
            fareMWK: fare,
            baseFareMWK: baseFare,
            bookingFeeMWK: 150,
            driverShareMWK: driverShare,
            commissionMWK: commission,
            pin,
            idempotencyKey: reqData.idempotencyKey || `REQ-${socket.userId}-${Date.now()}`,
            paymentMethod: (reqData.paymentMethod && reqData.paymentMethod.toUpperCase().includes('CASH')) ? 'CASH' : 'WALLET_ESCROW'
          },
          include: {
            rider: { select: { id: true, name: true, phone: true } }
          }
        });

        // Insert intermediate stops if present
        if (effectiveStops.length > 0) {
          for (let i = 0; i < effectiveStops.length; i++) {
            const st = effectiveStops[i];
            await tx.tripStop.create({
              data: {
                tripId: created.id,
                sequence: i + 1,
                address: st.address || st.name || `Stop ${i + 1}`,
                lat: parseFloat(st.lat),
                lng: parseFloat(st.lng)
              }
            });
          }
        }

        // Insert ParcelDetail if PARCEL
        if (serviceType === 'PARCEL' && deliveryCodeHash) {
          const p = reqData.parcelDetail || reqData.parcel || {};
          await tx.parcelDetail.create({
            data: {
              tripId: created.id,
              category: p.category || 'General Package',
              size: p.size || 'SMALL',
              fragile: Boolean(p.fragile),
              notes: p.notes || null,
              recipientName: p.recipientName || 'Recipient',
              recipientPhone: p.recipientPhone || '+265991234567',
              deliveryCodeHash,
              deliveryAttempts: 0
            }
          });
        }

        await tx.tripStatusHistory.create({
          data: {
            tripId: created.id,
            fromStatus: null,
            status: 'REQUESTED',
            changedBy: socket.userId,
            reason: serviceType === 'PARCEL' ? 'Rider booked parcel delivery' : 'Rider initiated booking'
          }
        });

        return created;
      }, { maxWait: 10000, timeout: 30000 });

      // When PARCEL_CODE_DELIVERY === 'sender' (default), provide the code to the sender in app until SMS works
      if (serviceType === 'PARCEL' && deliveryCode && parcelDeliveryChannel === 'sender') {
        trip.deliveryCode = deliveryCode;
      }

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

      const MAX_COMMISSION_DEBT_MWK = parseInt(process.env.MAX_COMMISSION_DEBT_MWK, 10) || 15000;
      if (parsed.data.status === 'ONLINE' && driver.commissionDebtMWK > MAX_COMMISSION_DEBT_MWK) {
        throw new Error(`Driver cannot go online: Outstanding commission debt (MK ${driver.commissionDebtMWK.toLocaleString()}) exceeds the limit of MK ${MAX_COMMISSION_DEBT_MWK.toLocaleString()}. Please settle your commission.`);
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

      // Write GPS trail point if driver is on an active trip
      const activeTrip = await prisma.trip.findFirst({
        where: {
          driverId: socket.driverId,
          status: { in: ['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
        },
        select: { id: true, status: true }
      });
      if (activeTrip) {
        // Fire-and-forget: do not block the socket event
        recordLocationPoint({
          tripId:   activeTrip.id,
          driverId: socket.driverId,
          lat:      parsed.data.lat,
          lng:      parsed.data.lng,
          speed:    parsed.data.speed   ?? null,
          heading:  parsed.data.heading ?? null,
          recordedAt: new Date()
        }).catch(e => console.warn('[GPSTrail] recordLocationPoint error:', e.message));
      }

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

      // Parcel delivery verification: recipient one-time code required
      if (trip.serviceType === 'PARCEL') {
        const parcel = await prisma.parcelDetail.findUnique({ where: { tripId: trip.id } });
        if (parcel) {
          if (parcel.deliveryAttempts >= 5) {
            throw new Error('Parcel delivery locked: Maximum 5 incorrect delivery code attempts exceeded. Contact safety desk.');
          }

          const inputCode = (completionData.deliveryCode || completionData.recipientPin || '').toString().trim();
          if (!inputCode) {
            throw new Error('Recipient one-time delivery code required to complete parcel delivery.');
          }

          const testHash = hashDeliveryCode(inputCode);
          if (testHash !== parcel.deliveryCodeHash) {
            const nextAttempts = parcel.deliveryAttempts + 1;
            await prisma.parcelDetail.update({
              where: { id: parcel.id },
              data: { deliveryAttempts: nextAttempts }
            });

            await prisma.auditLog.create({
              data: {
                userId: socket.userId,
                action: 'PARCEL_DELIVERY_CODE_ATTEMPT',
                entityType: 'PARCEL',
                entityId: parcel.id,
                details: { success: false, attempts: nextAttempts }
              }
            });

            if (nextAttempts >= 5) {
              throw new Error('Parcel delivery locked: Maximum 5 incorrect delivery code attempts exceeded. Contact safety desk.');
            }

            throw new Error(`Incorrect parcel delivery code. Attempt ${nextAttempts} of 5.`);
          }

          // Verified delivery
          await prisma.parcelDetail.update({
            where: { id: parcel.id },
            data: {
              deliveredAt: new Date(),
              proofNote: completionData.proofNote || 'Delivered to recipient with verified delivery code'
            }
          });

          await prisma.auditLog.create({
            data: {
              userId: socket.userId,
              action: 'PARCEL_DELIVERED',
              entityType: 'PARCEL',
              entityId: parcel.id,
              details: { success: true }
            }
          });
        }
      }

      const settleResult = await dbLedger.settleRide({
        tripId: trip.id,
        paymentMethod,
        driverTipMWK: driverTip,
        changedBy: socket.userId
      });

      if (trip.driverId) {
        await prisma.driver.update({
          where: { id: trip.driverId },
          data: {
            availability: 'ONLINE',
            tripsCompleted: { increment: 1 }
          }
        }).catch(e => console.warn('[TripComplete] Error resetting driver availability:', e.message));
      }

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

  // 8. Trip Rating (bidirectional: rider rates driver AND driver rates rider)
  // Uses ratingService which atomically writes Rating row + updates running averages.
  socket.on('trip:rate', async (review = {}, callback) => {
    try {
      const parsed = socketTripRateSchema.safeParse(review);
      if (!parsed.success) throw new Error('Invalid rating payload');

      const { tripId, rating, tags, comment } = parsed.data;

      // Look up the trip to find the toUserId (the other party)
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        include: { driver: { select: { userId: true } } }
      });
      if (!trip) throw new Error('Trip not found');
      if (trip.status !== 'COMPLETED') throw new Error('Ratings only allowed on completed trips');

      // Determine target: if I am the rider, rate the driver; if I am driver, rate the rider
      let toUserId;
      if (socket.userId === trip.riderId) {
        toUserId = trip.driver?.userId;
      } else if (trip.driver?.userId === socket.userId) {
        toUserId = trip.riderId;
      } else {
        throw new Error('You are not a party to this trip');
      }
      if (!toUserId) throw new Error('Cannot determine rating target');

      const { rating: savedRating, direction } = await ratingService.submitRating({
        tripId,
        fromUserId: socket.userId,
        toUserId,
        stars: Math.min(5, Math.max(1, parseInt(rating, 10) || 5)),
        tags: Array.isArray(tags) ? tags : [],
        comment: comment || null
      });

      io.to(`trip:${tripId}`).emit('trip:rated', {
        tripId, direction, stars: savedRating.stars, fromUserId: socket.userId
      });
      if (typeof callback === 'function') callback({ success: true, direction, rating: savedRating });
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
