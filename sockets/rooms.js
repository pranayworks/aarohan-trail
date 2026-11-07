// Server-controlled room membership. Clients can never join rooms themselves:
// rooms are derived from the verified login (JWT) and database ownership.

const { OPS_ROOM, userRoom, driverRoom, tripRoom } = require('./emitters');

const OPS_ROLES = ['ADMIN', 'SUPPORT'];
const ACTIVE_STATUSES = ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'];

async function joinUserRooms(socket, prisma) {
  // Joined synchronously, before any await, so events can never be missed.
  socket.join(userRoom(socket.userId));
  if (socket.driverId) socket.join(driverRoom(socket.driverId));
  if (OPS_ROLES.includes(socket.userRole)) socket.join(OPS_ROOM);

  // Re-join active trip rooms after a reload or reconnect.
  try {
    const ownership = [{ riderId: socket.userId }];
    if (socket.driverId) ownership.push({ driverId: socket.driverId });
    const active = await prisma.trip.findMany({
      where: { OR: ownership, status: { in: ACTIVE_STATUSES } },
      select: { id: true },
      take: 5
    });
    for (const t of active) socket.join(tripRoom(t.id));
  } catch (err) {
    console.warn('[Rooms] Could not restore trip rooms:', err.message);
  }
}

module.exports = { joinUserRooms, OPS_ROLES, ACTIVE_STATUSES };
