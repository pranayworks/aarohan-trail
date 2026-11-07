// ============================================================================
// Aarohan realtime delivery rules (privacy + safety)
// ----------------------------------------------------------------------------
// NEVER broadcast with io.emit(): every event goes only to the people who are
// part of it, through server-controlled rooms:
//   user:<userId>    every socket of that user (joined on connection)
//   driver:<driverId> ride offers for one driver
//   trip:<tripId>    the rider and driver of one trip
//   ops              ADMIN / SUPPORT staff only
// The safety PIN and parcel delivery code are delivered to the RIDER only.
// ============================================================================

const OPS_ROOM = 'ops';
const userRoom = (id) => `user:${id}`;
const driverRoom = (id) => `driver:${id}`;
const tripRoom = (id) => `trip:${id}`;

const SECRET_TRIP_FIELDS = ['pin', 'deliveryCode', 'deliveryCodeHash'];

function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = { ...obj };
  for (const f of SECRET_TRIP_FIELDS) delete copy[f];
  return copy;
}

function publicUser(u) {
  return u ? { id: u.id, name: u.name, phone: u.phone } : u;
}

function publicVehicle(v) {
  return v
    ? { type: v.type, makeModel: v.makeModel, color: v.color, plateNumber: v.plateNumber, year: v.year }
    : v;
}

// Keep only what the other party needs: no debts, emergency contacts, GPS history.
function publicDriver(d) {
  if (!d) return d;
  return {
    id: d.id,
    userId: d.userId,
    rating: d.rating,
    ratingCount: d.ratingCount,
    tripsCompleted: d.tripsCompleted,
    user: publicUser(d.user),
    vehicle: publicVehicle(d.vehicle)
  };
}

function minimizeTrip(trip) {
  if (!trip || typeof trip !== 'object') return trip;
  const out = { ...trip };
  if (out.rider) out.rider = publicUser(out.rider);
  if (out.driver) out.driver = publicDriver(out.driver);
  return out;
}

function partiesOf(trip) {
  if (!trip) return {};
  return {
    riderId: trip.riderId || trip.rider?.id || null,
    driverUserId: trip.driver?.userId || trip.driver?.user?.id || null
  };
}

// Rider receives the trip INCLUDING the PIN. The driver and ops receive it WITHOUT.
function emitTripEvent(io, event, trip, build = (t) => t, extraParties = {}) {
  if (!io || !trip) return;
  const p = { ...partiesOf(trip), ...extraParties };
  const riderView = minimizeTrip(trip);
  const safeView = stripSecrets(riderView);

  if (p.riderId) io.to(userRoom(p.riderId)).emit(event, build(riderView));

  const targets = [OPS_ROOM];
  if (p.driverUserId) targets.push(userRoom(p.driverUserId));
  io.to(targets).emit(event, build(safeView));
}

function emitToUser(io, userId, event, payload) {
  if (io && userId) io.to(userRoom(userId)).emit(event, payload);
}

function emitToDriver(io, driverId, event, payload) {
  if (io && driverId) io.to(driverRoom(driverId)).emit(event, payload);
}

function emitToOps(io, event, payload) {
  if (io) io.to(OPS_ROOM).emit(event, payload);
}

module.exports = {
  OPS_ROOM, userRoom, driverRoom, tripRoom,
  stripSecrets, minimizeTrip, partiesOf,
  emitTripEvent, emitToUser, emitToDriver, emitToOps
};
