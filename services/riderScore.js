// ============================================================================
// Rider rating, calculated live (never a stored running average).
//
//   starting point : the average of the stars drivers gave this rider (5.0 if nobody has rated yet)
//   late cancels   : cancelling AFTER a captain was assigned lowers the score
//   early cancels  : cancelling before any captain was assigned lowers it only a little
//   both are measured over the rider's last 30 finished trips, and the score stays between 1.0 and 5.0
// ============================================================================

const round1 = (n) => Math.round(n * 10) / 10;

const LATE_WEIGHT = 4;     // 25% late cancels would cost the maximum penalty
const LATE_MAX = 1.5;
const EARLY_WEIGHT = 1;
const EARLY_MAX = 0.5;
const WINDOW = 30;

function scoreFrom({ stars = [], trips = [] }) {
  const ratingsCount = stars.length;
  const average = ratingsCount ? stars.reduce((a, b) => a + b, 0) / ratingsCount : 5;

  const finished = trips.slice(0, WINDOW);
  const cancelled = finished.filter((t) => t.status === 'CANCELLED_BY_RIDER');
  const late = cancelled.filter((t) => !!t.driverId).length;
  const early = cancelled.length - late;
  const total = finished.length;

  const latePenalty = total ? Math.min(LATE_MAX, (late / total) * LATE_WEIGHT) : 0;
  const earlyPenalty = total ? Math.min(EARLY_MAX, (early / total) * EARLY_WEIGHT) : 0;
  const score = Math.max(1, Math.min(5, average - latePenalty - earlyPenalty));

  return {
    score: round1(score),
    average: round1(average),
    ratingsCount,
    finishedTrips: total,
    completedTrips: finished.filter((t) => t.status === 'COMPLETED').length,
    lateCancellations: late,
    earlyCancellations: early,
    latePenalty: round1(latePenalty),
    earlyPenalty: round1(earlyPenalty)
  };
}

async function computeRiderScore(prisma, userId) {
  const [ratings, trips] = await Promise.all([
    prisma.rating.findMany({ where: { toUserId: userId }, orderBy: { createdAt: 'desc' }, take: 50, select: { stars: true } }),
    prisma.trip.findMany({
      where: { riderId: userId, status: { in: ['COMPLETED', 'CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER'] } },
      orderBy: { createdAt: 'desc' },
      take: WINDOW,
      select: { status: true, driverId: true }
    })
  ]);
  return scoreFrom({ stars: ratings.map((r) => r.stars), trips });
}

module.exports = { computeRiderScore, scoreFrom };
