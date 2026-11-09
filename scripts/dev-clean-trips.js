// DEVELOPMENT ONLY: shows and clears leftover test trips/offers that make drivers look "busy".
//   node scripts/dev-clean-trips.js          (shows counts only)
//   node scripts/dev-clean-trips.js --clear  (cancels leftover active trips and expires pending offers)
'use strict';
require('dotenv').config();
if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'development') {
  console.error('Refusing to run: NODE_ENV must be "development".');
  process.exit(1);
}
const prisma = require('../lib/prisma');
(async () => {
  const active = await prisma.trip.groupBy({ by: ['status'], where: { status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] } }, _count: true });
  const offers = await prisma.tripOffer.count({ where: { status: 'PENDING' } });
  const pendingLive = await prisma.tripOffer.count({ where: { status: 'PENDING', expiresAt: { gt: new Date() } } });
  console.log('Active trips by status:', JSON.stringify(active));
  console.log('Pending offers:', offers, '(not yet expired:', pendingLive + ')');
  const limit = require('../services/commissionLimit').limitMWK();
  const base = { approvalStatus: 'APPROVED', availability: 'ONLINE', user: { status: 'ACTIVE' }, vehicle: { type: 'CAB' } };
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  console.log('Online approved CAB drivers:', await prisma.driver.count({ where: base }));
  console.log('  ...with a GPS fix in the last 24h:', await prisma.driver.count({ where: { ...base, lastLocationAt: { gte: cutoff } } }));
  console.log('  ...owing LESS than the limit (MK ' + limit + '):', await prisma.driver.count({ where: { ...base, commissionDebtMWK: { lt: limit } } }));
  console.log('  ...owing the limit or more (blocked from orders):', await prisma.driver.count({ where: { ...base, commissionDebtMWK: { gte: limit } } }));
  if (process.argv.includes('--clear')) {
    const t = await prisma.trip.updateMany({ where: { status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] } }, data: { status: 'EXPIRED', cancelledBy: 'SYSTEM', cancelReason: 'Dev cleanup' } });
    const o = await prisma.tripOffer.updateMany({ where: { status: 'PENDING' }, data: { status: 'EXPIRED' } });
    console.log('Cancelled trips:', t.count, ' Expired offers:', o.count);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
