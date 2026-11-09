// ============================================================================
// AAROHAN SUPPORT TICKETS ROUTER • LILONGWE, MALAWI
// Rider/Driver: create ticket, add message, view own tickets.
// Admin/Support: list all, reply, update status, resolve.
// ============================================================================

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: requires role in [${roles.join(', ')}]` });
    }
    next();
  };
}

const ticketService = require('../services/supportTicket');

// ---- Rider/Driver ----

// POST /api/tickets — create a new ticket
router.post('/tickets', requireAuth, async (req, res) => {
  try {
    const { tripId, category, subject, description, priority } = req.body;
    const ticket = await ticketService.createTicket({
      userId: req.user.id,
      tripId, category, subject, description, priority
    });
    res.status(201).json({ success: true, ticket });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/tickets — list own tickets
router.get('/tickets', requireAuth, async (req, res) => {
  try {
    const page  = parseInt(req.query.page  || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const data  = await ticketService.getUserTickets(req.user.id, { page, limit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/:ticketId — get one ticket (must own it or be admin/support)
router.get('/tickets/:ticketId', requireAuth, async (req, res) => {
  try {
    const prisma = require('../lib/prisma');
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const isAdmin = ['ADMIN', 'SUPPORT', 'FINANCE'].includes(req.user.role);
    if (!isAdmin && ticket.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets/:ticketId/messages — add message to ticket
router.post('/tickets/:ticketId/messages', requireAuth, async (req, res) => {
  try {
    const { body } = req.body;
    const message = await ticketService.addTicketMessage({
      ticketId:   req.params.ticketId,
      authorId:   req.user.id,
      authorRole: req.user.role,
      body
    });
    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Admin/Support ----

// GET /api/admin/tickets — list all tickets
router.get('/admin/tickets', requireAuth, requireRole('ADMIN', 'SUPPORT', 'FINANCE'), async (req, res) => {
  try {
    const { status, priority, category, role, page, limit } = req.query;
    const data = await ticketService.adminListTickets({
      adminId: req.user.id,
      status, priority, category, role,
      page:  parseInt(page  || '1',  10),
      limit: parseInt(limit || '50', 10)
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/tickets/:ticketId — update status/resolution
router.patch('/admin/tickets/:ticketId', requireAuth, requireRole('ADMIN', 'SUPPORT'), async (req, res) => {
  try {
    const { status, resolution, assignedTo, priority } = req.body;
    const updated = await ticketService.updateTicketStatus({
      ticketId:   req.params.ticketId,
      adminId:    req.user.id,
      status, resolution, assignedTo, priority
    });
    res.json({ success: true, ticket: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

