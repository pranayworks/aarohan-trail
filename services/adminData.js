// Everything the admin panel needs to see that is not tied to one screen: the audit trail, the messages log,
// and what every driver has earned and owes. All of it comes straight from the database.
const prisma = require('../lib/prisma');

const num = (v, d, lo, hi) => Math.min(hi, Math.max(lo, parseInt(v, 10) || d));

async function auditTrail({ action, entityType, userId, q, from, to, page, limit }) {
  const take = num(limit, 50, 1, 200), pg = num(page, 1, 1, 10000);
  const where = {};
  if (action) where.action = String(action);
  if (entityType) where.entityType = String(entityType);
  if (userId) where.userId = String(userId);
  if (q) where.OR = [{ entityId: { contains: String(q).slice(0, 60) } }, { user: { name: { contains: String(q).slice(0, 60), mode: 'insensitive' } } }];
  if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (pg - 1) * take, take, include: { user: { select: { id: true, name: true, role: true } } } }),
    prisma.auditLog.count({ where })
  ]);
  return { total, page: pg, limit: take, rows: rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, entityType: r.entityType, entityId: r.entityId, who: r.user ? { id: r.user.id, name: r.user.name, role: r.user.role } : null, ip: r.ipAddress, details: r.details })) };
}

async function messages({ channel, status, purpose, page, limit }) {
  const take = num(limit, 50, 1, 200), pg = num(page, 1, 1, 10000);
  const where = {};
  if (channel && channel !== 'SMS') where.channel = String(channel);
  if (status) where.status = String(status);
  if (purpose) where.purpose = String(purpose);
  const wantLog = channel !== 'SMS', wantSms = !channel || channel === 'SMS';
  const [logs, sms, sent24, failed24] = await Promise.all([
    wantLog ? prisma.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (pg - 1) * take, take }) : [],
    wantSms && !purpose && !status ? prisma.smsLog.findMany({ orderBy: { createdAt: 'desc' }, take }) : [],
    prisma.messageLog.count({ where: { status: { in: ['SENT', 'SIMULATED'] }, createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.messageLog.count({ where: { status: 'FAILED', createdAt: { gte: new Date(Date.now() - 86400000) } } })
  ]);
  const rows = logs.map((m) => ({ id: m.id, at: m.createdAt, channel: m.channel, purpose: m.purpose, to: m.toMasked, subject: m.subject, status: m.status, provider: m.provider, error: m.error }))
    .concat(sms.map((s) => ({ id: s.id, at: s.createdAt, channel: 'SMS', purpose: s.purpose, to: s.phoneMasked, subject: null, status: s.status, provider: s.provider, error: s.errorCode })))
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, take);
  return { rows, sentLast24h: sent24, failedLast24h: failed24 };
}

// What each driver earned in a period: the fares, their share, Aarohan's commission, and what they still owe.
async function driverEarnings({ from, to }) {
  const where = { status: 'COMPLETED', driverId: { not: null }, ...(from || to ? { completedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) };
  const groups = await prisma.trip.groupBy({ by: ['driverId'], where, _sum: { fareMWK: true, driverShareMWK: true, commissionMWK: true }, _count: { _all: true } });
  const ids = groups.map((g) => g.driverId);
  const drivers = ids.length ? await prisma.driver.findMany({ where: { id: { in: ids } }, select: { id: true, commissionDebtMWK: true, rating: true, approvalStatus: true, user: { select: { name: true, phone: true } }, vehicle: { select: { plateNumber: true, type: true } } } }) : [];
  const byId = Object.fromEntries(drivers.map((d) => [d.id, d]));
  const rows = groups.map((g) => { const d = byId[g.driverId] || {}; return { driverId: g.driverId, name: d.user && d.user.name, phone: d.user && d.user.phone, plate: d.vehicle && d.vehicle.plateNumber, vehicle: d.vehicle && d.vehicle.type, trips: g._count._all, gross: g._sum.fareMWK || 0, driverShare: g._sum.driverShareMWK || 0, commission: g._sum.commissionMWK || 0, owes: d.commissionDebtMWK || 0, rating: d.rating, status: d.approvalStatus }; }).sort((a, b) => b.gross - a.gross);
  const totals = rows.reduce((t, r) => ({ trips: t.trips + r.trips, gross: t.gross + r.gross, driverShare: t.driverShare + r.driverShare, commission: t.commission + r.commission, owes: t.owes + r.owes }), { trips: 0, gross: 0, driverShare: 0, commission: 0, owes: 0 });
  return { rows, totals };
}

module.exports = { auditTrail, messages, driverEarnings };
