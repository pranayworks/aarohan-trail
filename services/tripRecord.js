// ============================================================================
// AAROHAN TRIP RECORD SERVICE • LILONGWE, MALAWI
// getFullTripRecord(tripId): complete record for admin, audit, legal.
// Admin GPS/chat/ticket access writes an AuditLog row.
// RETENTION: configurable via RECORD_RETENTION_MONTHS env (default 12).
// ============================================================================

const prisma = require('../lib/prisma');

const RETENTION_MONTHS = parseInt(process.env.RECORD_RETENTION_MONTHS || '12', 10);

/**
 * Returns the complete trip record for a given tripId.
 * Includes every sub-record needed for legal/safety/audit purposes.
 */
async function getFullTripRecord(tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      rider: {
        select: {
          id: true, phone: true, name: true,
          riderRating: true, ratingCount: true
        }
      },
      driver: {
        include: {
          user: { select: { id: true, phone: true, name: true } },
          vehicle: true
        }
      },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      stops: { orderBy: { sequence: 'asc' } },
      locationPoints: { orderBy: { recordedAt: 'asc' } },
      chatMessages: { orderBy: { createdAt: 'asc' } },
      ratings: true,
      ledgerEntries: { orderBy: { createdAt: 'asc' } },
      payments: true,
      settlement: true,
      sosEvents: true,
      supportTickets: {
        include: { messages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' }
      },
      parcelDetail: true
    }
  });

  if (!trip) return null;

  return {
    trip,
    retentionExpiresAt: new Date(
      new Date(trip.createdAt).getTime() +
      RETENTION_MONTHS * 30 * 24 * 60 * 60 * 1000
    ).toISOString()
  };
}

/**
 * Write an AuditLog for admin access to sensitive sub-records.
 * @param {'GPS_TRAIL'|'CHAT'|'TICKETS'|'FULL_RECORD'} accessType
 */
async function logAdminTripAccess(tripId, adminUserId, accessType, ipAddress, userAgent) {
  const actionMap = {
    GPS_TRAIL:   'ADMIN_GPS_TRAIL_VIEWED',
    CHAT:        'ADMIN_CHAT_VIEWED',
    TICKETS:     'ADMIN_TICKETS_VIEWED',
    FULL_RECORD: 'ADMIN_TRIP_RECORD_VIEWED'
  };

  const action = actionMap[accessType];
  if (!action) throw new Error(`Unknown accessType: ${accessType}`);

  await prisma.auditLog.create({
    data: {
      userId:     adminUserId,
      action,
      entityType: 'TRIP',
      entityId:   tripId,
      details:    { accessType },
      ipAddress:  ipAddress || null,
      userAgent:  userAgent || null
    }
  });
}

/**
 * Write a TripLocationPoint (GPS trail entry).
 * Only written while trip is DRIVER_ARRIVING, ARRIVED, or IN_TRANSIT.
 */
async function recordLocationPoint({ tripId, driverId, lat, lng, speed, heading, recordedAt }) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { status: true }
  });

  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const eligibleStatuses = ['DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'];
  if (!eligibleStatuses.includes(trip.status)) {
    return null; // Silently skip — not an error
  }

  return prisma.tripLocationPoint.create({
    data: {
      tripId,
      driverId,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      speed:   speed   != null ? parseFloat(speed)   : null,
      heading: heading != null ? parseFloat(heading)  : null,
      recordedAt: recordedAt ? new Date(recordedAt) : new Date()
    }
  });
}

module.exports = { getFullTripRecord, logAdminTripAccess, recordLocationPoint, RETENTION_MONTHS };

