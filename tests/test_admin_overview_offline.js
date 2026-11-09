'use strict';
// The admin Overview numbers: today, 7 days and what needs attention.
let passed = 0, total = 0;
const report = (n, ok, d = '') => { total++; if (ok) { passed++; console.log(`✅ [PASS] ${n}`); } else console.log(`❌ [FAIL] ${n}${d ? '  ::  ' + d : ''}`); };
const NOW = new Date('2026-11-09T10:00:00.000Z'); // 12:00 in Malawi
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000);
const trips = [
  { status: 'COMPLETED', createdAt: hoursAgo(2), completedAt: hoursAgo(1), fareMWK: 1800, commissionMWK: 540 },
  { status: 'COMPLETED', createdAt: hoursAgo(5), completedAt: hoursAgo(4), fareMWK: 3050, commissionMWK: 915 },
  { status: 'COMPLETED', createdAt: hoursAgo(30), completedAt: hoursAgo(29), fareMWK: 5950, commissionMWK: 1785 },   // yesterday
  { status: 'COMPLETED', createdAt: hoursAgo(24 * 9), completedAt: hoursAgo(24 * 9 - 1), fareMWK: 9999, commissionMWK: 9999 }, // too old
  { status: 'CANCELLED_BY_RIDER', createdAt: hoursAgo(3), completedAt: null, fareMWK: 1800, commissionMWK: 0 },
  { status: 'REQUESTED', createdAt: hoursAgo(1), completedAt: null, fareMWK: 1800, commissionMWK: 0 }
];
const prisma = {
  trip: {
    findMany: async ({ where }) => trips.filter((t) => t.status === 'COMPLETED' && t.completedAt >= where.completedAt.gte),
    count: async ({ where }) => trips.filter((t) => t.createdAt >= where.createdAt.gte && (!where.status || where.status.in.includes(t.status))).length
  },
  driver: { aggregate: async () => ({ _sum: { commissionDebtMWK: 7300 } }), count: async ({ where }) => (where.availability ? 4 : 3) },
  supportTicket: { count: async () => 5 }, commissionRemittance: { count: async () => 2 }, user: { count: async () => 12 }
};
const pp = require.resolve('../lib/prisma'); require.cache[pp] = { id: pp, filename: pp, loaded: true, exports: prisma };
const { overview, blantyreDayStart } = require('../services/adminOverview');
(async () => {
  const o = await overview(NOW);
  report('Today counts completed rides, money and Aarohan\'s commission', o.today.completed === 2 && o.today.gross === 4850 && o.today.commission === 1455);
  report('Today also counts every request and the cancelled ones', o.today.requested === 4 && o.today.cancelled === 1);
  report('The last 7 days include yesterday but not rides older than a week', o.week.completed === 3 && o.week.gross === 10800 && o.days.length === 7);
  report('The days are in order, oldest first, ending today', o.days[6].date === '2026-11-09' && o.days[5].date === '2026-11-08' && o.days[5].trips === 1 && o.days[0].trips === 0);
  report('Things that need attention are counted', o.attention.pendingApplications === 3 && o.attention.pendingPayments === 2 && o.attention.openTickets === 5 && o.attention.commissionOwedMWK === 7300);
  report('Drivers online and new people are shown', o.driversOnline === 4 && o.newUsers7d === 12);
  const late = blantyreDayStart(new Date('2026-11-09T23:30:00.000Z')); // 01:30 on the 10th in Malawi
  report('A new day starts at midnight in Malawi, not midnight UTC', late.toISOString() === '2026-11-09T22:00:00.000Z');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'adminUsers.js'), 'utf8');
  report('Only staff can see the overview', /'\/admin\/overview', requireRole\('ADMIN', 'SUPPORT', 'FINANCE'\)/.test(src));
  console.log(`\n   ADMIN OVERVIEW RESULTS: ${passed}/${total} TESTS PASSED`); process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('crashed', e); process.exit(1); });
