// The numbers on the admin Overview page: today, the last 7 days, and what needs attention.
const prisma = require('../lib/prisma');

const blantyreDayStart = (now) => { const t = new Date(now.getTime() + 2 * 3600000); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - 2 * 3600000); };
const dayKey = (d) => new Date(new Date(d).getTime() + 2 * 3600000).toISOString().slice(0, 10);

async function overview(now = new Date()) {
  const dayStart = blantyreDayStart(now), weekStart = new Date(dayStart.getTime() - 6 * 86400000);
  const cancelled = ['CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER'];
  const [weekTrips, requestedToday, cancelledToday, debt, online, pendingApps, openTickets, pendingPayments, newUsers] = await Promise.all([
    prisma.trip.findMany({ where: { status: 'COMPLETED', completedAt: { gte: weekStart } }, select: { completedAt: true, fareMWK: true, commissionMWK: true }, take: 20000 }),
    prisma.trip.count({ where: { createdAt: { gte: dayStart } } }),
    prisma.trip.count({ where: { createdAt: { gte: dayStart }, status: { in: cancelled } } }),
    prisma.driver.aggregate({ _sum: { commissionDebtMWK: true } }),
    prisma.driver.count({ where: { availability: { in: ['ONLINE', 'BUSY'] } } }),
    prisma.driver.count({ where: { approvalStatus: 'PENDING', kyc: { is: { submittedAt: { not: null } } } } }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.commissionRemittance.count({ where: { status: 'PENDING_VERIFICATION' } }),
    prisma.user.count({ where: { createdAt: { gte: weekStart }, role: { in: ['RIDER', 'DRIVER'] } } })
  ]);
  const days = [];
  for (let i = 6; i >= 0; i--) days.push({ date: dayKey(new Date(dayStart.getTime() - i * 86400000 + 3600000)), trips: 0, gross: 0, commission: 0 });
  const byDay = Object.fromEntries(days.map((d) => [d.date, d]));
  weekTrips.forEach((t) => { const d = byDay[dayKey(t.completedAt)]; if (d) { d.trips++; d.gross += t.fareMWK || 0; d.commission += t.commissionMWK || 0; } });
  const today = byDay[days[days.length - 1].date];
  return {
    today: { requested: requestedToday, completed: today.trips, cancelled: cancelledToday, gross: today.gross, commission: today.commission },
    week: { completed: days.reduce((a, d) => a + d.trips, 0), gross: days.reduce((a, d) => a + d.gross, 0), commission: days.reduce((a, d) => a + d.commission, 0) },
    days,
    attention: { pendingApplications: pendingApps, pendingPayments, openTickets, commissionOwedMWK: (debt._sum && debt._sum.commissionDebtMWK) || 0 },
    driversOnline: online, newUsers7d: newUsers
  };
}
module.exports = { overview, blantyreDayStart };
