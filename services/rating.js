// ============================================================================
// AAROHAN RATING SERVICE • LILONGWE, MALAWI
// Bidirectional rating: rider rates driver AND driver rates rider.
// Enforces: one rating per trip per author.
// Updates running averages in a single Prisma transaction.
// ============================================================================

const prisma = require('../lib/prisma');

/**
 * Submit a rating for a completed trip.
 * Called from socket tripHandlers on 'trip:rate'.
 *
 * @param {object} opts
 * @param {string} opts.tripId
 * @param {string} opts.fromUserId   — the author (rider or driver's userId)
 * @param {string} opts.toUserId     — the target (the other party's userId)
 * @param {number} opts.stars        — integer 1-5
 * @param {string[]} opts.tags       — optional tags array
 * @param {string} [opts.comment]    — optional comment
 */
async function submitRating({ tripId, fromUserId, toUserId, stars, tags = [], comment }) {
  const starsInt = parseInt(stars, 10);
  if (!Number.isInteger(starsInt) || starsInt < 1 || starsInt > 5) {
    throw new Error('Rating must be an integer between 1 and 5.');
  }

  // Verify trip is COMPLETED
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { status: true, riderId: true, driverId: true, driver: { select: { userId: true } } }
  });

  if (!trip) throw new Error(`Trip ${tripId} not found.`);
  if (trip.status !== 'COMPLETED') throw new Error('Ratings can only be submitted for completed trips.');

  // Verify the fromUser is actually a party to this trip
  const riderUserId  = trip.riderId;
  const driverUserId = trip.driver?.userId;

  if (fromUserId !== riderUserId && fromUserId !== driverUserId) {
    throw new Error('You are not a party to this trip.');
  }
  if (toUserId !== riderUserId && toUserId !== driverUserId) {
    throw new Error('Target user is not a party to this trip.');
  }
  if (fromUserId === toUserId) {
    throw new Error('You cannot rate yourself.');
  }

  // Determine which direction: rider-rates-driver or driver-rates-rider
  const ratingDirection = (fromUserId === riderUserId) ? 'RIDER_TO_DRIVER' : 'DRIVER_TO_RIDER';

  // Run as an atomic transaction
  return prisma.$transaction(async (tx) => {
    // Enforce uniqueness: one rating per trip per author (@@unique([tripId, fromUserId]))
    const existing = await tx.rating.findUnique({
      where: { tripId_fromUserId: { tripId, fromUserId } }
    });
    if (existing) throw new Error('You have already rated this trip.');

    // Insert the Rating row
    const rating = await tx.rating.create({
      data: { tripId, fromUserId, toUserId, stars: starsInt, tags, comment }
    });

    // Update the running average on the target
    if (ratingDirection === 'RIDER_TO_DRIVER') {
      // Rider rated driver — update Driver.rating + ratingCount
      const driver = await tx.driver.findFirst({ where: { userId: toUserId } });
      if (driver) {
        const newCount  = driver.ratingCount + 1;
        const newRating = ((driver.rating * driver.ratingCount) + starsInt) / newCount;
        await tx.driver.update({
          where: { id: driver.id },
          data: { rating: parseFloat(newRating.toFixed(2)), ratingCount: newCount }
        });
      }
    } else {
      // Driver rated rider — update User.riderRating + ratingCount
      const user = await tx.user.findUnique({ where: { id: toUserId } });
      if (user) {
        const newCount  = user.ratingCount + 1;
        const newRating = ((user.riderRating * user.ratingCount) + starsInt) / newCount;
        await tx.user.update({
          where: { id: toUserId },
          data: { riderRating: parseFloat(newRating.toFixed(2)), ratingCount: newCount }
        });
      }
    }

    return { rating, direction: ratingDirection };
  });
}

/**
 * Get ratings for a trip (both directions if submitted).
 */
async function getTripRatings(tripId) {
  return prisma.rating.findMany({
    where: { tripId },
    include: {
      fromUser: { select: { id: true, name: true, role: true } },
      toUser:   { select: { id: true, name: true, role: true } }
    },
    orderBy: { createdAt: 'asc' }
  });
}

module.exports = { submitRating, getTripRatings };

