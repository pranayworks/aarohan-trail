// ============================================================================
// Aarohan financial reports, computed from PostgreSQL (single source of truth).
// "Platform revenue" = commission earned on COMPLETED trips. Cash commission is
// earned immediately but collected later through driver remittances.
// ============================================================================

const prisma = require('../lib/prisma');

async function platformFinancialReport() {
  const completed = { status: 'COMPLETED' };
  const [all, cash, digital, debt, payouts] = await Promise.all([
    prisma.trip.aggregate({
      where: completed,
      _sum: { fareMWK: true, commissionMWK: true, driverShareMWK: true, driverTipMWK: true },
      _count: { _all: true }
    }),
    prisma.trip.aggregate({
      where: { ...completed, paymentMethod: 'CASH' },
      _sum: { fareMWK: true, commissionMWK: true },
      _count: { _all: true }
    }),
    prisma.trip.aggregate({
      where: { ...completed, paymentMethod: { not: 'CASH' } },
      _sum: { fareMWK: true, commissionMWK: true },
      _count: { _all: true }
    }),
    prisma.driver.aggregate({ _sum: { commissionDebtMWK: true } }),
    prisma.payment.aggregate({
      where: { type: 'PAYOUT', status: 'SUCCESS' },
      _sum: { amountMWK: true }
    })
  ]);

  const cashCommissionEarned = cash._sum.commissionMWK || 0;
  const outstanding = debt._sum.commissionDebtMWK || 0;

  return {
    source: 'postgres',
    totalRidesCount: all._count._all,
    totalGMV: all._sum.fareMWK || 0,
    netPlatformRevenue: all._sum.commissionMWK || 0,
    driverEarningsTotal: (all._sum.driverShareMWK || 0) + (all._sum.driverTipMWK || 0),
    tipsTotal: all._sum.driverTipMWK || 0,
    cashRidesCount: cash._count._all,
    cashGrossVolume: cash._sum.fareMWK || 0,
    digitalRidesCount: digital._count._all,
    digitalGrossVolume: digital._sum.fareMWK || 0,
    cashCommissionEarned,
    outstandingCashCommission: outstanding,
    cashCommissionCollected: Math.max(0, cashCommissionEarned - outstanding),
    completedPayoutsTotal: payouts._sum.amountMWK || 0
  };
}

async function driverFinancialSummary(driverId) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) return null;

  const [trips, cashTrips, pending, verified] = await Promise.all([
    prisma.trip.aggregate({
      where: { driverId, status: 'COMPLETED' },
      _sum: { fareMWK: true, driverShareMWK: true, driverTipMWK: true, commissionMWK: true },
      _count: { _all: true }
    }),
    prisma.trip.aggregate({
      where: { driverId, status: 'COMPLETED', paymentMethod: 'CASH' },
      _sum: { fareMWK: true },
      _count: { _all: true }
    }),
    prisma.commissionRemittance.aggregate({
      where: { driverId, status: 'PENDING_VERIFICATION' },
      _sum: { amountMWK: true }
    }),
    prisma.commissionRemittance.aggregate({
      where: { driverId, status: 'VERIFIED' },
      _sum: { amountMWK: true }
    })
  ]);

  return {
    source: 'postgres',
    driverId,
    tripsCompleted: trips._count._all,
    grossFaresMWK: trips._sum.fareMWK || 0,
    netEarningsMWK: (trips._sum.driverShareMWK || 0) + (trips._sum.driverTipMWK || 0),
    tipsMWK: trips._sum.driverTipMWK || 0,
    platformCommissionMWK: trips._sum.commissionMWK || 0,
    cashTripsCount: cashTrips._count._all,
    cashCollectedMWK: cashTrips._sum.fareMWK || 0,
    commissionDebtMWK: driver.commissionDebtMWK,
    pendingRemittancesMWK: pending._sum.amountMWK || 0,
    verifiedRemittancesMWK: verified._sum.amountMWK || 0,
    // Legacy field names kept for older clients
    cashCollectedByDriver: cashTrips._sum.fareMWK || 0,
    totalCashCommissionIncurred: Math.round((cashTrips._sum.fareMWK || 0) * 0.30),
    verifiedCashRemitted: verified._sum.amountMWK || 0,
    outstandingCashCommissionDebt: driver.commissionDebtMWK
  };
}

async function ledgerEntries({ limit = 200 } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
  return prisma.ledgerEntry.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, journalId: true, account: true, type: true, amountMWK: true,
      balanceAfterMWK: true, description: true, reference: true, tripId: true, createdAt: true
    }
  });
}


// Recent completed trips shaped for the admin "double-entry records" table (oldest first).
async function tripBreakdowns({ limit = 200 } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
  const trips = await prisma.trip.findMany({
    where: { status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take,
    select: {
      id: true, pickupAddress: true, dropoffAddress: true, paymentMethod: true,
      fareMWK: true, commissionMWK: true, driverShareMWK: true, driverTipMWK: true
    }
  });
  return trips.reverse().map((t) => ({
    rideId: t.id.slice(0, 8).toUpperCase(),
    pickupAddress: t.pickupAddress,
    destinationAddress: t.dropoffAddress,
    paymentMethod: t.paymentMethod,
    grossFare: t.fareMWK,
    eligibleFare: t.fareMWK,
    commissionAmount: t.commissionMWK,
    totalDriverNetEarnings: (t.driverShareMWK || 0) + (t.driverTipMWK || 0)
  }));
}

// Per-driver cash collection / commission position for the admin reconciliation table.
async function driverDebtTable({ limit = 100 } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 300);
  const drivers = await prisma.driver.findMany({
    where: { OR: [{ commissionDebtMWK: { gt: 0 } }, { tripsCompleted: { gt: 0 } }] },
    orderBy: { commissionDebtMWK: 'desc' },
    take,
    include: {
      user: { select: { name: true, phone: true } },
      vehicle: { select: { plateNumber: true } }
    }
  });
  const ids = drivers.map((d) => d.id);
  if (ids.length === 0) return [];

  const [cash, verified] = await Promise.all([
    prisma.trip.groupBy({
      by: ['driverId'],
      where: { driverId: { in: ids }, status: 'COMPLETED', paymentMethod: 'CASH' },
      _sum: { fareMWK: true, commissionMWK: true }
    }),
    prisma.commissionRemittance.groupBy({
      by: ['driverId'],
      where: { driverId: { in: ids }, status: 'VERIFIED' },
      _sum: { amountMWK: true }
    })
  ]);
  const cashBy = new Map(cash.map((c) => [c.driverId, c._sum]));
  const verBy = new Map(verified.map((v) => [v.driverId, v._sum.amountMWK || 0]));

  return drivers.map((d) => ({
    driverId: d.id,
    name: d.user?.name || 'Driver Partner',
    phone: d.user?.phone || null,
    plateNumber: d.vehicle?.plateNumber || null,
    cashCollectedMWK: cashBy.get(d.id)?.fareMWK || 0,
    commissionIncurredMWK: cashBy.get(d.id)?.commissionMWK || 0,
    verifiedRemittedMWK: verBy.get(d.id) || 0,
    outstandingDebtMWK: d.commissionDebtMWK
  }));
}

module.exports = { platformFinancialReport, driverFinancialSummary, ledgerEntries, tripBreakdowns, driverDebtTable };
