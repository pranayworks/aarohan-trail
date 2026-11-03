// Gaman Driver Registry & Real-Time Dispatch Engine • Lilongwe, Malawi
// Manages active driver telemetry, nearby search by real GPS, and atomic trip assignment.

const pricingService = require('./pricing');
const financeService = require('./finance');

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
    // Map of driverId -> driver profile & live telemetry
    this.drivers = new Map();
    // Map of tripId -> active trip state
    this.trips = new Map();
  }

  // Register or update driver profile
  registerDriver(driverData) {
    if (!driverData || !driverData.id) return null;
    const existing = this.drivers.get(driverData.id) || {};
    const updated = Object.assign(existing, driverData, {
      lastSeen: Date.now()
    });
    this.drivers.set(driverData.id, updated);
    return updated;
  }

  // Update driver live GPS telemetry
  updateDriverLocation(driverId, coords) {
    let driver = this.drivers.get(driverId);
    if (!driver) {
      driver = this.registerDriver({
        id: driverId,
        name: coords.name || 'Driver Partner',
        phone: coords.phone || '+265 99 554 1122',
        plate: coords.plate || 'BW 4920',
        vehicleType: coords.tier || 'cab',
        carModel: coords.car || 'Toyota Corolla',
        status: 'ONLINE'
      });
    }

    driver.location = {
      lat: parseFloat(coords.lat),
      lng: parseFloat(coords.lng),
      heading: coords.heading || 0,
      accuracy: coords.accuracy || 15,
      speed: coords.speed || 0,
      timestamp: Date.now()
    };
    driver.lastSeen = Date.now();
    return driver;
  }

  setDriverStatus(driverId, status) {
    const driver = this.drivers.get(driverId);
    if (!driver) return null;
    driver.status = status; // 'ONLINE', 'BUSY', 'OFFLINE'
    driver.lastSeen = Date.now();
    return driver;
  }

  // Find eligible nearby drivers within radius (km) matching vehicle tier
  findNearbyDrivers(pickupLat, pickupLng, tierId, maxRadiusKm = 7.0) {
    const pLat = parseFloat(pickupLat);
    const pLng = parseFloat(pickupLng);
    const now = Date.now();
    const staleThresholdMs = 2 * 60 * 60 * 1000; // 2 hours tolerance

    const matches = [];



    for (const [id, driver] of this.drivers.entries()) {
      // Must be ONLINE
      if (driver.status !== 'ONLINE') continue;

      // Must have recent GPS
      if (!driver.location) continue;
      if (driver.lastSeen && (now - driver.lastSeen > staleThresholdMs)) continue;

      // Filter by vehicle type tier if specified
      if (tierId && driver.vehicleType && driver.vehicleType !== tierId) continue;

      const distKm = haversineDistanceKm(pLat, pLng, driver.location.lat, driver.location.lng);
      if (distKm <= maxRadiusKm) {
        matches.push({
          driverId: driver.id,
          name: driver.name,
          phone: driver.phone,
          plate: driver.plate,
          carModel: driver.carModel,
          vehicleType: driver.vehicleType,
          rating: driver.rating,
          tripsCompleted: driver.tripsCompleted,
          location: driver.location,
          distanceKm: parseFloat(distKm.toFixed(2)),
          etaMins: Math.max(2, Math.ceil(distKm * 2.2))
        });
      }
    }

    matches.sort((a, b) => a.distanceKm - b.distanceKm);
    return matches;
  }

  // Create an authoritative trip booking
  createTripBooking({ quoteId, tierId, riderId, riderName, riderPhone, paymentMethod }) {
    // 1. Authoritatively validate and consume quote
    const validatedQuote = pricingService.validateAndConsumeQuote(quoteId, tierId);

    const tripId = 'TRIP-AAR-' + Math.floor(1000 + Math.random() * 9000);
    const pin = Math.floor(1000 + Math.random() * 9000).toString();

    const trip = {
      id: tripId,
      status: 'REQUESTED',
      pin,
      rider: {
        id: riderId || 'USR-RIDER-1',
        name: riderName || 'AArohan Passenger',
        phone: riderPhone || '+265 99 123 4567'
      },
      driver: null,
      pickup: (typeof validatedQuote.pickup === 'string') ? validatedQuote.pickup : (validatedQuote.pickup?.name || validatedQuote.pickup?.address || 'Pickup Point'),
      destination: (typeof validatedQuote.destination === 'string') ? validatedQuote.destination : (validatedQuote.destination?.name || validatedQuote.destination?.address || 'Destination'),
      pickupCoords: { lat: validatedQuote.pickup?.lat, lng: validatedQuote.pickup?.lng },
      dropoffCoords: { lat: validatedQuote.destination?.lat, lng: validatedQuote.destination?.lng },
      tier: validatedQuote.tier.name,
      tierId: validatedQuote.tier.tierId,
      fare: validatedQuote.tier.finalFare,
      baseFare: validatedQuote.tier.breakdown.baseFare,
      distanceKm: validatedQuote.distanceKm,
      durationMins: validatedQuote.durationMins,
      routeGeometry: validatedQuote.routeGeometry,
      paymentMethod: paymentMethod || 'Airtel Money Locked Escrow',
      requestedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      acceptedAt: null,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null
    };

    this.trips.set(tripId, trip);
    return trip;
  }

  // Driver atomically accepts trip
  acceptTrip(tripId, driverId) {
    const trip = this.trips.get(tripId);
    if (!trip) throw new Error('Trip not found');

    if (trip.status !== 'REQUESTED') {
      throw new Error(`Trip already handled (current status: ${trip.status})`);
    }

    const driver = this.drivers.get(driverId) || Array.from(this.drivers.values())[0];
    if (!driver) throw new Error('Driver not found');

    trip.status = 'ACCEPTED';
    trip.driver = {
      id: driver.id,
      name: driver.name,
      phone: driver.phone,
      plate: driver.plate,
      carModel: driver.carModel,
      rating: driver.rating,
      location: driver.location
    };
    trip.acceptedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    driver.status = 'BUSY';
    return { trip, driver };
  }

  // Driver arrives at pickup
  markDriverArrived(tripId) {
    const trip = this.trips.get(tripId);
    if (!trip) throw new Error('Trip not found');

    trip.status = 'ARRIVED';
    trip.arrivedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return trip;
  }

  // Driver starts ride
  startTransit(tripId) {
    const trip = this.trips.get(tripId);
    if (!trip) throw new Error('Trip not found');

    trip.status = 'IN_TRANSIT';
    trip.startedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return trip;
  }

  // Driver completes ride & settles escrow
  completeTrip(tripId, { driverTip = 0, paymentMethod = null } = {}) {
    const trip = this.trips.get(tripId);
    if (!trip) throw new Error('Trip not found');

    trip.status = 'COMPLETED';
    trip.completedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (trip.driver) {
      const driver = this.drivers.get(trip.driver.id);
      if (driver) {
        driver.status = 'ONLINE';
        driver.tripsCompleted = (driver.tripsCompleted || 0) + 1;
      }
    }

    const payMethod = paymentMethod || trip.paymentMethod || 'CASH';
    const driverId = trip.driver?.id || trip.driverId;
    if (!driverId) throw new Error('Cannot complete trip without assigned driverId');
    const riderId = trip.rider?.id || trip.riderId;
    if (!riderId) throw new Error('Cannot complete trip without assigned riderId');

    const settlementResult = financeService.settleCompletedRide({
      rideId: trip.id,
      quoteId: trip.quoteId,
      versionId: trip.versionId || 'AAROHAN-PRICE-V1',
      categoryId: trip.tierId || 'cab',
      driverId,
      riderId,
      grossFare: trip.fare,
      driverTip,
      bookingFee: trip.bookingFee || 0,
      paymentMethod: payMethod,
      pickupAddress: trip.pickup?.name || trip.pickup,
      destinationAddress: trip.destination?.name || trip.destination
    });

    return {
      trip,
      settlement: settlementResult.breakdown,
      commission: settlementResult.commissionEntry,
      driverEarnings: settlementResult.driverEntry
    };
  }

  // Cancel trip
  cancelTrip(tripId, reason = 'Cancelled by user') {
    const trip = this.trips.get(tripId);
    if (!trip) return null;

    trip.status = 'IDLE';
    trip.cancelledAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    trip.cancelReason = reason;

    if (trip.driver) {
      const driver = this.drivers.get(trip.driver.id);
      if (driver) driver.status = 'ONLINE';
    }

    return trip;
  }

  // Security: Never expose Trip.pin in any driver-facing response
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
