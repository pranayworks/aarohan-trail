// ============================================================================
// ADMIN: find and open ANY rider or driver account (/api/admin/users...).
// Staff only. Every view and every status change is written to the audit log.
// ============================================================================

const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireRole, validateBody } = require('../middleware/auth');
const auth = require('../middleware/auth');

const router = express.Router();
const STAFF = ['ADMIN', 'SUPPORT'];

// GET /api/admin/overview: the numbers for the Overview page
router.get('/admin/overview', requireRole('ADMIN', 'SUPPORT', 'FINANCE'), async (req, res) => {
  try { res.json({ success: true, ...(await require('../services/adminOverview').overview()) }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/users?role=RIDER|DRIVER&q=text&status=ACTIVE&page=1
router.get('/admin/users', requireRole(...STAFF), async (req, res) => {
  try {
    const { role, q, status } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10)), limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '30', 10)));
    const where = {};
    if (role === 'RIDER' || role === 'DRIVER') where.role = role; else where.role = { in: ['RIDER', 'DRIVER'] };
    if (status) where.status = String(status);
    const term = String(q || '').trim().slice(0, 60);
    if (term) where.OR = [{ name: { contains: term, mode: 'insensitive' } }, { phone: { contains: term } }, { email: { contains: term.toLowerCase(), mode: 'insensitive' } }, { referralCode: { equals: term.toUpperCase() } }];
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, select: { id: true, name: true, phone: true, email: true, role: true, status: true, createdAt: true, referralCode: true } }),
      prisma.user.count({ where })
    ]);
    res.json({ success: true, users, total, page, limit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/users/:id  everything about one account
router.get('/admin/users/:id', requireRole(...STAFF), async (req, res) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        emergencyContacts: { orderBy: { position: 'asc' } },
        savedPlaces: true,
        referredBy: { select: { id: true, name: true, referralCode: true } },
        driverProfile: { include: { vehicle: true } }
      }
    });
    if (!u || !['RIDER', 'DRIVER'].includes(u.role)) return res.status(404).json({ error: 'User not found' });

    const tripWhere = u.role === 'DRIVER' ? { driverId: u.driverProfile && u.driverProfile.id } : { riderId: u.id };
    const [recentTrips, completed, cancelled, tickets, referredCount] = await Promise.all([
      prisma.trip.findMany({ where: tripWhere, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, status: true, serviceType: true, pickupAddress: true, dropoffAddress: true, fareMWK: true, createdAt: true, cancelReason: true } }),
      prisma.trip.count({ where: { ...tripWhere, status: 'COMPLETED' } }),
      prisma.trip.count({ where: { ...tripWhere, status: { in: ['CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER'] } } }),
      prisma.supportTicket.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, subject: true, status: true, category: true, createdAt: true } }),
      prisma.user.count({ where: { referredById: u.id } })
    ]);

    // Money and documents for this account, straight from the database
    let money = null, documents = [];
    try {
      if (prisma.trip.aggregate) { const agg = await prisma.trip.aggregate({ where: { ...tripWhere, status: 'COMPLETED' }, _sum: { fareMWK: true, driverShareMWK: true, commissionMWK: true } }); money = { gross: agg._sum.fareMWK || 0, driverShare: agg._sum.driverShareMWK || 0, commission: agg._sum.commissionMWK || 0 }; }
      if (u.driverProfile && prisma.driverDocument && prisma.driverDocument.findMany) documents = await prisma.driverDocument.findMany({ where: { driverId: u.driverProfile.id }, select: { type: true, status: true } });
    } catch (_) { /* optional */ }

    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_USER_VIEWED', entityType: 'USER', entityId: u.id, details: { role: u.role }, ipAddress: req.ip } }).catch(() => {});

    res.json({
      success: true,
      user: {
        id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role, status: u.status, gender: u.gender,
        dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : null, createdAt: u.createdAt,
        referralCode: u.referralCode, referredBy: u.referredBy || null, referredCount,
        emergencyContacts: u.emergencyContacts, savedPlaces: u.savedPlaces,
        driver: u.driverProfile ? { id: u.driverProfile.id, approvalStatus: u.driverProfile.approvalStatus, availability: u.driverProfile.availability, commissionDebtMWK: u.driverProfile.commissionDebtMWK, rating: u.driverProfile.rating, ratingCount: u.driverProfile.ratingCount, tripsCompleted: u.driverProfile.tripsCompleted, documents, vehicle: u.driverProfile.vehicle || null } : null
      },
      stats: { completed, cancelled }, money, recentTrips, tickets
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/users/:id/status  { status: 'ACTIVE' | 'SUSPENDED', reason }
router.post('/admin/users/:id/status', requireRole('ADMIN'), validateBody(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(3).max(300) })), async (req, res) => {
  try {
    const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, status: true } });
    if (!u || !['RIDER', 'DRIVER'].includes(u.role)) return res.status(404).json({ error: 'User not found' });
    if (u.status === 'DELETED') return res.status(409).json({ error: 'This account was deleted by its owner.' });
    await prisma.user.update({ where: { id: u.id }, data: { status: req.body.status } });
    if (req.body.status === 'SUSPENDED') await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (auth.clearAuthCache) auth.clearAuthCache(u.id);
    await prisma.auditLog.create({ data: { userId: req.user.id, action: 'ADMIN_USER_STATUS_CHANGED', entityType: 'USER', entityId: u.id, details: { from: u.status, to: req.body.status, reason: req.body.reason }, ipAddress: req.ip } });
    res.json({ success: true, status: req.body.status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
