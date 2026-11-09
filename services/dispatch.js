// ============================================================================
// AArohan Real-Time Dispatch Engine • Lilongwe, Malawi
// PostgreSQL-Driven Spatial Fleet Discovery & Sequential Offer Queue
// ============================================================================

const prisma = require('../lib/prisma');
const pricingService = require('./pricing');
const financeService = require('./finance');
const dbLedger = require('./dbLedger');
const pushNotificationService = require('./pushNotification');

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class DispatchService {
  constructor() {
    this.offerTimers = new Map(); // tripId -> NodeJS timeout
    this.gpsThrottle = new Map(); // driverId -> timestamp ms of last DB save
    this.io = null;
  }

  setSocketServer(io) {
    this.io = io;
  }

  clearOfferTimer(tripId) {
    if (this.offerTimers.has(tripId)) {
      clearTimeout(this.offerTimers.get(tripId));
      this.offerTimers.delete(tripId);
    }
  }

  clearAllOfferTimers() {
    for (const timer of this.offerTimers.values()) {
      clearTimeout(timer);
    }
    this.offerTimers.clear();
  }

  // ---------------------------------------------------------------------------
  // 1. Spatial Driver Discovery from PostgreSQL
  // ---------------------------------------------------------------------------
  async findNearbyDrivers(pickupLat, pickupLng, tierId = null, maxRadiusKm = 7.0) {
    const pLat = parseFloat(pickupLat);
    const pLng = parseFloat(pickupLng);
    const radiusKm = parseFloat(maxRadiusKm) || 7.0;

    if (isNaN(pLat) || isNaN(pLng)) return [];

    // Bounding Box Pre-Filter
    const latDelta = radiusKm / 111.0;
    const cosLat = Math.cos(pLat * Math.PI / 180);
    const lngDelta = radiusKm / (111.0 * (Math.abs(cosLat) > 0.001 ? Math.abs(cosLat) : 1.0));

    // Only drivers with a RECENT GPS fix may receive an offer. Production default: 3 minutes
    // (DRIVER_GPS_FRESH_SECONDS). Development keeps a long window so seeded fixtures stay eligible.
    const defaultFreshSeconds = process.env.NODE_ENV === 'production' ? 180 : 24 * 60 * 60;
    const freshSeconds = parseInt(process.env.DRIVER_GPS_FRESH_SECONDS, 10) || defaultFreshSeconds;
    const freshWindowMs = freshSeconds * 1000;
    const freshCutoff = new Date(Date.now() - freshWindowMs);

    const maxDebtLimit = require('./commissionLimit').limitMWK();
    const where = {
      approvalStatus: 'APPROVED',
      availability: 'ONLINE',
      commissionDebtMWK: {
        lt: maxDebtLimit // a driver who owes the limit or more gets no orders
      },
      currentLat: {
        gte: pLat - latDelta,
        lte: pLat + latDelta
      },
      currentLng: {
        gte: pLng - lngDelta,
        lte: pLng + lngDelta
      },
      lastLocationAt: {
        gte: freshCutoff
      },
      user: {
        status: 'ACTIVE'
      }
    };

    if (tierId) {
      const normalizedTier = tierId.toUpperCase();
      if (['MOTO', 'AUTO', 'CAB'].includes(normalizedTier)) {
        where.vehicle = { type: normalizedTier };
      }
    }

    const dbDrivers = await prisma.driver.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
        vehicle: true
      }
    });

    const matches = [];
    for (const driver of dbDrivers) {
      if (driver.currentLat == null || driver.currentLng == null) continue;

      const distKm = haversineDistanceKm(pLat, pLng, driver.currentLat, driver.currentLng);
      if (distKm <= radiusKm) {
        matches.push({
          driverId: driver.id,
          id: driver.id,
          userId: driver.userId,
          name: driver.user?.name || 'Captain Partner',
          phone: driver.user?.phone || '',
          plate: driver.vehicle?.plateNumber || '',
          plateNumber: driver.vehicle?.plateNumber || '',
          carModel: driver.vehicle?.makeModel || '',
          vehicleType: driver.vehicle?.type?.toLowerCase() || 'cab',
          rating: driver.rating,
          tripsCompleted: driver.tripsCompleted,
          location: {
            lat: driver.currentLat,
            lng: driver.currentLng,
            heading: driver.currentHeading || 0,
            timestamp: driver.lastLocationAt ? driver.lastLocationAt.getTime() : Date.now()
          },
          distanceKm: parseFloat(distKm.toFixed(2)),
          etaMinutes: Math.max(2, Math.ceil(distKm * 2.2))
        });
      }
    }

    // Sort Nearest First
    matches.sort((a, b) => a.distanceKm - b.distanceKm);
    return matches;
  }

  // ---------------------------------------------------------------------------
  // 2. Throttled GPS Persistence & Streaming
  // ---------------------------------------------------------------------------
  async updateDriverLocation(driverId, coords) {
    if (!driverId || !coords) return null;
    const lat = parseFloat(coords.lat);
    const lng = parseFloat(coords.lng);
    const heading = coords.heading != null ? parseFloat(coords.heading) : 0;
    const now = Date.now();

    if (isNaN(lat) || isNaN(lng)) return null;

    // Throttle database persistence to once every 5 seconds per driver
    const lastSave = this.gpsThrottle.get(driverId) || 0;
    if (now - lastSave >= 5000) {
      this.gpsThrottle.set(driverId, now);
      try {
        await prisma.driver.updateMany({
          where: { id: driverId },
          data: {
            currentLat: lat,
            currentLng: lng,
            currentHeading: heading,
            lastLocationAt: new Date()
          }
        });
      } catch (err) {
        console.warn('[Dispatch] Driver GPS persist warning:', err.message);
      }
    }

    const locPayload = {
      driverId,
      lat,
      lng,
      heading,
      accuracy: coords.accuracy || 10,
      speed: coords.speed || 0,
      timestamp: now
    };

    // If driver has an active trip, stream directly to the rider's trip room
    try {
      const activeTrip = await prisma.trip.findFirst({
        where: {
          driverId,
          status: { in: ['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
        },
        select: { id: true }
      });

      if (activeTrip && this.io) {
        this.io.to(`trip:${activeTrip.id}`).emit('trip:driver_moved', locPayload);
      }
    } catch (e) {
      // Quiet fail on lookup
    }

    // Live driver GPS goes only to ops staff (the trip room above covers the rider).
    if (this.io) {
      this.io.to('ops').emit('trip:driver_moved', locPayload);
    }

    return {
      driverId,
      id: driverId,
      location: locPayload
    };
  }

  // Development only: say exactly why nobody could be matched, stage by stage.
  async diagnoseNoDrivers(trip) {
    if (process.env.NODE_ENV === 'production') return null;
    const all = await prisma.driver.findMany({ include: { vehicle: true }, take: 200 });
    const tier = String(trip.tier || '').toUpperCase();
    const lines = [`Requested vehicle: ${tier || 'any'}`, `Drivers in the system: ${all.length}`];
    const approved = all.filter((d) => d.approvalStatus === 'APPROVED'); lines.push(`Approved: ${approved.length}`);
    const online = approved.filter((d) => d.availability === 'ONLINE'); lines.push(`Online: ${online.length}${online.length === 0 ? ' (the driver must tap Go online and stay on that screen)' : ''}`);
    const located = online.filter((d) => d.currentLat != null && d.currentLng != null); lines.push(`Online and sending a location: ${located.length}`);
    const types = [...new Set(located.map((d) => d.vehicle && d.vehicle.type).filter(Boolean))];
    const matching = located.filter((d) => !tier || (d.vehicle && d.vehicle.type === tier));
    lines.push(`With a ${tier || 'any'} vehicle: ${matching.length}${located.length && !matching.length ? ` (online vehicle types: ${types.join(', ')}. The rider must book that type)` : ''}`);
    const near = matching.map((d) => haversineDistanceKm(trip.pickupLat, trip.pickupLng, d.currentLat, d.currentLng)).sort((a, b) => a - b);
    if (near.length) lines.push(`Nearest matching driver is ${near[0].toFixed(1)} km from the pickup (the limit is 15 km${near[0] > 15 ? ', so the driver or the rider is in the wrong place. Use Test location on both' : ''})`);
    return lines;
  }

  async setDriverStatus(driverId, status) {
    if (!driverId) return null;
    const updated = await prisma.driver.update({
      where: { id: driverId },
      data: { availability: status, lastLocationAt: new Date() }
    });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // 3. Sequential Single-Driver Offering Engine
  // ---------------------------------------------------------------------------
  async startDispatch(tripId) {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        offers: true,
        rider: { select: { id: true, name: true, phone: true } }
      }
    });

    if (!trip || trip.driverId || !['REQUESTED', 'OFFERED'].includes(trip.status)) {
      return null;
    }

    // Find nearby eligible drivers in corridor
    const nearby = await this.findNearbyDrivers(trip.pickupLat, trip.pickupLng, trip.tier, 15.0);

    // Filter out drivers who already received an offer for this trip
    const offeredDriverIds = new Set(trip.offers.map(o => o.driverId));

    // Filter out drivers currently assigned to an active trip
    const busyTrips = await prisma.trip.findMany({
      where: {
        status: { in: ['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] },
        driverId: { not: null }
      },
      select: { driverId: true }
    });
    const busyDriverIds = new Set(busyTrips.map(t => t.driverId));

    // Filter out drivers with active pending offers on other trips
    const activeOffers = await prisma.tripOffer.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: new Date() }
      },
      select: { driverId: true }
    });
    const pendingOfferDriverIds = new Set(activeOffers.map(o => o.driverId));

    const eligible = nearby.filter(d => 
      !offeredDriverIds.has(d.driverId) &&
      !busyDriverIds.has(d.driverId) &&
      !pendingOfferDriverIds.has(d.driverId)
    );

    // If no eligible drivers remain in the queue
    if (eligible.length === 0) {
      console.log(`[Dispatch] All drivers exhausted for trip ${tripId}. Marking NO_DRIVERS.`);
      await prisma.trip.update({
        where: { id: tripId },
        data: {
          status: 'NO_DRIVERS',
          cancelledBy: 'SYSTEM',
          cancelReason: 'No available drivers found in corridor'
        }
      });
      await prisma.tripStatusHistory.create({
        data: {
          tripId,
          fromStatus: trip.status,
          status: 'NO_DRIVERS',
          changedBy: 'SYSTEM',
          reason: 'Dispatch exhausted: no drivers accepted or available'
        }
      });

      let debug = null;
      try { debug = await this.diagnoseNoDrivers(trip); if (debug) console.log('[Dispatch] No match for trip ' + tripId + ' -> ' + debug.join(' | ')); } catch (_) { /* diagnostics are optional */ }
      if (this.io) {
        this.io.to(`trip:${tripId}`).to(`user:${trip.riderId}`).emit('trip:no_drivers', { tripId, debug });
      }
      return null;
    }

    // Pick NEAREST available driver
    const targetDriver = eligible[0];
    const expiresAt = new Date(Date.now() + 15000); // 15-second decision window

    // Re-verify trip is still unassigned before creating offer
    const freshTrip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!freshTrip || freshTrip.driverId || !['REQUESTED', 'OFFERED'].includes(freshTrip.status)) {
      return null;
    }

    const offer = await prisma.tripOffer.create({
      data: {
        tripId,
        driverId: targetDriver.driverId,
        status: 'PENDING',
        expiresAt
      }
    });

    await prisma.trip.updateMany({
      where: { id: tripId, status: 'REQUESTED', driverId: null },
      data: { status: 'OFFERED' }
    });

    console.log(`[Dispatch] Trip ${tripId} offered to driver ${targetDriver.driverId} (15s window).`);

    if (this.io) {
      const driverSafeTrip = await this.attachParcelForDriver(this.getDriverSafeTrip(trip));
      // Until the driver accepts, they see the rider's first name only. The phone number is shared after accepting.
      if (driverSafeTrip && driverSafeTrip.rider) {
        driverSafeTrip.rider = { ...driverSafeTrip.rider, phone: undefined, name: String(driverSafeTrip.rider.name || 'Rider').split(' ')[0] };
      }
      this.io.to(`driver:${targetDriver.driverId}`).emit('trip:offer', { offer, trip: driverSafeTrip });
      // Only the rider learns that an offer was made (never the other drivers).
      this.io.to(`user:${trip.riderId}`).emit('trip:offered', {
        tripId,
        offerId: offer.id,
        expiresAt
      });
    }

    // Trigger FCM Background Push Notification to the targeted driver's native device
    if (targetDriver.userId) {
      const isParcel = trip.serviceType === 'PARCEL';
      const offerTitle = isParcel ? 'New parcel delivery offer' : 'New ride offer';
      const offerBody = `Pickup: ${trip.pickupAddress || 'Lilongwe'} • MWK ${(trip.driverShareMWK || trip.fareMWK || 0).toLocaleString()}`;
      pushNotificationService.sendPushToUser(targetDriver.userId, {
        title: offerTitle,
        body: offerBody,
        data: {
          type: 'TRIP_OFFER',
          tripId: trip.id,
          offerId: offer.id,
          expiresAt: expiresAt.toISOString(),
          fareMWK: String(trip.driverShareMWK || trip.fareMWK)
        }
      }).catch(e => console.warn('[DispatchFCM] Push dispatch warning:', e.message));
    }

    // Schedule 15s timeout
    this.clearOfferTimer(tripId);
    const timer = setTimeout(async () => {
      try {
        await this.handleOfferTimeout(tripId, offer.id);
      } catch (err) {
        console.error('[Dispatch] Error in offer timeout handler:', err.message);
      }
    }, 15000);
    this.offerTimers.set(tripId, timer);

    return offer;
  }

  // ---------------------------------------------------------------------------
  // 4. Offer Timeout & Decline Handling
  // ---------------------------------------------------------------------------
  async handleOfferTimeout(tripId, offerId) {
    this.clearOfferTimer(tripId);

    const offer = await prisma.tripOffer.findUnique({ where: { id: offerId } });
    if (!offer || offer.status !== 'PENDING') return;

    await prisma.tripOffer.update({
      where: { id: offerId },
      data: { status: 'EXPIRED', respondedAt: new Date() }
    });

    console.log(`[Dispatch] Offer ${offerId} expired for trip ${tripId}. Offering to next driver...`);

    // Verify trip is still unassigned
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (trip && ['REQUESTED', 'OFFERED'].includes(trip.status) && !trip.driverId) {
      await this.startDispatch(tripId);
    }
  }

  async declineTripOffer(tripId, driverId) {
    this.clearOfferTimer(tripId);

    const offer = await prisma.tripOffer.findFirst({
      where: { tripId, driverId, status: 'PENDING' }
    });

    if (offer) {
      await prisma.tripOffer.update({
        where: { id: offer.id },
        data: { status: 'REJECTED', respondedAt: new Date() }
      });
      console.log(`[Dispatch] Driver ${driverId} rejected offer for trip ${tripId}. Advancing...`);
    }

    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (trip && ['REQUESTED', 'OFFERED'].includes(trip.status) && !trip.driverId) {
      await this.startDispatch(tripId);
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Atomic Accept
  // ---------------------------------------------------------------------------
  async acceptTrip(tripId, driverId) {
    this.clearOfferTimer(tripId);

    return await prisma.$transaction(async (tx) => {
      // 1. Validate driver account is approved and active
      const driver = await tx.driver.findFirst({
        where: {
          id: driverId,
          approvalStatus: 'APPROVED',
          user: { status: 'ACTIVE' }
        },
        include: {
          user: { select: { id: true, name: true, phone: true } },
          vehicle: true
        }
      });

      if (!driver) {
        throw new Error('Driver account is not active or approved');
      }

      const activeTrip = await tx.trip.findFirst({
        where: {
          driverId,
          status: { in: ['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
        }
      });
      if (activeTrip) {
        throw new Error('Driver is already busy on an active trip');
      }

      // 2. Validate trip availability
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (!trip) throw new Error('Trip not found');
      if (trip.status !== 'REQUESTED' && trip.status !== 'OFFERED') {
        throw new Error(`Trip is no longer available (current status: ${trip.status})`);
      }
      if (trip.driverId) {
        throw new Error('Trip already accepted by another driver');
      }

      // 3. Atomic Conditional Update: exactly ONE driver wins
      const updateResult = await tx.trip.updateMany({
        where: {
          id: tripId,
          status: { in: ['REQUESTED', 'OFFERED'] },
          driverId: null
        },
        data: {
          driverId,
          status: 'DRIVER_ARRIVING',
          acceptedAt: new Date()
        }
      });

      if (updateResult.count === 0) {
        throw new Error('Trip already accepted by another driver');
      }

      // 4. Set driver to BUSY
      await tx.driver.update({
        where: { id: driverId },
        data: { availability: 'BUSY' }
      });

      // 5. Update winner's pending offer to ACCEPTED, or create ACCEPTED offer record for winner
      const pendingOffer = await tx.tripOffer.findFirst({
        where: { tripId, driverId, status: 'PENDING' }
      });
      if (pendingOffer) {
        await tx.tripOffer.update({
          where: { id: pendingOffer.id },
          data: { status: 'ACCEPTED', respondedAt: new Date() }
        });
      } else {
        await tx.tripOffer.create({
          data: {
            tripId,
            driverId,
            status: 'ACCEPTED',
            expiresAt: new Date(),
            respondedAt: new Date()
          }
        });
      }

      // 6. Expire all other pending offers for this trip
      await tx.tripOffer.updateMany({
        where: { tripId, status: 'PENDING', driverId: { not: driverId } },
        data: { status: 'EXPIRED', respondedAt: new Date() }
      });

      // 7. Record immutable audit history
      await tx.tripStatusHistory.create({
        data: {
          tripId,
          fromStatus: trip.status,
          status: 'DRIVER_ARRIVING',
          changedBy: driver.userId,
          reason: 'Driver accepted ride offer'
        }
      });

      const updatedTrip = await tx.trip.findUnique({
        where: { id: tripId },
        include: {
          rider: { select: { id: true, name: true, phone: true } },
          driver: { include: { user: { select: { id: true, name: true, phone: true } }, vehicle: true } }
        }
      });

      return { trip: updatedTrip, driver };
    }, { maxWait: 10000, timeout: 30000 });
  }

  // ---------------------------------------------------------------------------
  // 6. Resume Pending Offers on Server Restart
  // ---------------------------------------------------------------------------
  async resumePendingOffers() {
    try {
      const pendingOffers = await prisma.tripOffer.findMany({
        where: {
          status: 'PENDING',
          trip: {
            status: { in: ['REQUESTED', 'OFFERED'] },
            driverId: null
          }
        },
        include: { trip: true }
      });

      console.log(`[Dispatch] Resuming ${pendingOffers.length} pending dispatch offer(s)...`);

      for (const offer of pendingOffers) {
        const remainingMs = offer.expiresAt.getTime() - Date.now();
        if (remainingMs > 0) {
          const timer = setTimeout(async () => {
            try {
              await this.handleOfferTimeout(offer.tripId, offer.id);
            } catch (err) {
              console.error('[Dispatch] Error resuming timeout:', err.message);
            }
          }, remainingMs);
          this.offerTimers.set(offer.tripId, timer);
        } else {
          // Already expired during downtime
          await prisma.tripOffer.update({
            where: { id: offer.id },
            data: { status: 'EXPIRED', respondedAt: new Date() }
          });
          await this.startDispatch(offer.tripId);
        }
      }

      // Check unassigned REQUESTED trips created in the last 10 minutes without offers
      const unofferedTrips = await prisma.trip.findMany({
        where: {
          status: 'REQUESTED',
          driverId: null,
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          offers: { none: { status: 'PENDING' } }
        }
      });

      for (const t of unofferedTrips) {
        await this.startDispatch(t.id);
      }
    } catch (err) {
      console.warn('[Dispatch] Error in resumePendingOffers:', err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Trip Lifecycle Operations
  // ---------------------------------------------------------------------------
  async markDriverArrived(tripId) {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, status: 'DRIVER_ARRIVING' }
    });
    if (!trip) throw new Error('Active arriving trip not found');

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
          changedBy: trip.driverId,
          reason: 'Driver arrived at pickup location'
        }
      });
      return t;
    });

    return updated;
  }

  async startTransit(tripId) {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, status: 'ARRIVED' }
    });
    if (!trip) throw new Error('Arrived trip not found');

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
          changedBy: trip.driverId,
          reason: 'Passenger PIN verified, transit started'
        }
      });
      return t;
    });

    return updated;
  }

  async completeTrip(tripId, { driverTip = 0, paymentMethod = null, changedBy = null } = {}) {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, status: 'IN_TRANSIT' },
      include: { driver: true, rider: true }
    });
    if (!trip) throw new Error('In-transit trip not found');

    const payMethod = paymentMethod || trip.paymentMethod || 'CASH';
    const driverId = trip.driverId;
    if (!driverId) throw new Error('Cannot complete trip without assigned driverId');

    const settleResult = await dbLedger.settleRide({
      tripId: trip.id,
      paymentMethod: payMethod,
      driverTipMWK: driverTip,
      changedBy: changedBy || driverId
    });

    await prisma.driver.updateMany({
      where: { id: driverId },
      data: {
        availability: 'ONLINE',
        tripsCompleted: { increment: 1 }
      }
    });

    return {
      trip: settleResult.trip,
      journalId: settleResult.journalId,
      breakdown: settleResult.breakdown
    };
  }

  async cancelTrip(tripId, reason = 'Cancelled by user', cancelledBy = 'RIDER') {
    this.clearOfferTimer(tripId);

    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return null;

    const nextStatus = cancelledBy === 'DRIVER' ? 'CANCELLED_BY_DRIVER' : 'CANCELLED_BY_RIDER';

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.trip.update({
        where: { id: tripId },
        data: {
          status: nextStatus,
          cancelledBy,
          cancelReason: reason,
          cancelledAt: new Date()
        }
      });
      await tx.tripStatusHistory.create({
        data: {
          tripId,
          fromStatus: trip.status,
          status: nextStatus,
          changedBy: cancelledBy,
          reason
        }
      });
      if (trip.driverId) {
        await tx.driver.updateMany({
          where: { id: trip.driverId },
          data: { availability: 'ONLINE' }
        });
      }
      return t;
    });

    return updated;
  }

  // What a driver may know about a parcel: the item, the receiver and who pays. Never the delivery code.
  safeParcel(p) {
    if (!p) return null;
    return { category: p.category, size: p.size, fragile: p.fragile, notes: p.notes, weightKg: p.weightKg, payer: p.payer, recipientName: p.recipientName, recipientPhone: p.recipientPhone };
  }
  async attachParcelForDriver(trip) {
    if (!trip || trip.serviceType !== 'PARCEL') return trip;
    const detail = trip.parcelDetail || await prisma.parcelDetail.findUnique({ where: { tripId: trip.id } });
    return { ...trip, parcelDetail: this.safeParcel(detail) };
  }

  // Security: Never expose Trip.pin in driver-facing responses
  getDriverSafeTrip(trip) {
    if (!trip) return null;
    const { pin, ...driverSafeTrip } = trip;
    return driverSafeTrip;
  }
}

const dispatchServiceInstance = new DispatchService();
dispatchServiceInstance.stripPinForDriver = function(trip) {
  return dispatchServiceInstance.getDriverSafeTrip(trip);
};

module.exports = dispatchServiceInstance;
