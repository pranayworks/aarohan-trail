// ============================================================================
// AAROHAN SUPPORT TICKET SERVICE • LILONGWE, MALAWI
// SupportTicket CRUD + TicketMessage (append-only).
// AuditLog written on admin access to ticket list.
// ============================================================================

const prisma = require('../lib/prisma');
const supportMail = require('./supportMail');

const VALID_CATEGORIES = [
  'PAYMENT_DISPUTE', 'SAFETY', 'LOST_ITEM', 'DRIVER_CONDUCT',
  'APP_ISSUE', 'WRONG_FARE', 'PARCEL_ISSUE', 'OTHER'
];

/**
 * Create a SupportTicket (called by rider or driver).
 */
async function createTicket({ userId, tripId, category, subject, description, priority = 'MEDIUM' }) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
  }
  if (!subject || subject.trim().length < 3) throw new Error('Subject must be at least 3 characters.');
  if (!description || description.trim().length < 10) throw new Error('Description must be at least 10 characters.');

  const ticket = await prisma.supportTicket.create({
    data: {
      userId,
      tripId: tripId || null,
      category,
      subject:     subject.trim(),
      description: description.trim(),
      priority
    }
  });

  // Audit log
  await prisma.auditLog.create({
    data: {
      userId,
      action:     'TICKET_CREATED',
      entityType: 'SUPPORT_TICKET',
      entityId:   ticket.id,
      details:    { category, subject: ticket.subject, tripId: tripId || null }
    }
  });

  // Emails go out in the background so a slow mail provider never slows the rider down.
  supportMail.onTicketCreated(ticket).catch(() => {});
  return ticket;
}

/**
 * Add a message to a ticket (append-only).
 * authorRole must match the actual user's role.
 */
async function addTicketMessage({ ticketId, authorId, authorRole, body }) {
  if (!body || body.trim().length < 1) throw new Error('Message body cannot be empty.');

  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error(`Ticket ${ticketId} not found.`);
  if (ticket.status === 'CLOSED') throw new Error('Cannot add messages to a closed ticket.');

  const message = await prisma.ticketMessage.create({
    data: { ticketId, authorId, authorRole, body: body.trim() }
  });

  // Update ticket updatedAt
  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { updatedAt: new Date() }
  });

  await prisma.auditLog.create({
    data: {
      userId:     authorId,
      action:     'TICKET_MESSAGE_ADDED',
      entityType: 'SUPPORT_TICKET',
      entityId:   ticketId,
      details:    { messageId: message.id, authorRole }
    }
  });

  supportMail.onTicketMessage({ ticket, authorRole, body: message.body }).catch(() => {});
  return message;
}

/**
 * Resolve or update ticket status (admin/support only).
 */
async function updateTicketStatus({ ticketId, adminId, status, resolution, assignedTo, priority }) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error(`Ticket ${ticketId} not found.`);

  const updateData = { updatedAt: new Date() };
  if (status)     updateData.status     = status;
  if (resolution) updateData.resolution = resolution.trim();
  if (assignedTo) updateData.assignedTo = assignedTo;
  if (priority)   updateData.priority   = priority;
  if (status === 'RESOLVED' || status === 'CLOSED') {
    updateData.resolvedAt = new Date();
  }

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data: updateData
  });

  if (status === 'RESOLVED' || status === 'CLOSED') {
    await prisma.auditLog.create({
      data: {
        userId:     adminId,
        action:     'TICKET_RESOLVED',
        entityType: 'SUPPORT_TICKET',
        entityId:   ticketId,
        details:    { status, resolution, assignedTo }
      }
    });
  }

  return updated;
}

/**
 * Get tickets for a user (rider/driver view).
 */
async function getUserTickets(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;
  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where: { userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      skip, take: limit
    }),
    prisma.supportTicket.count({ where: { userId } })
  ]);
  return { tickets, total, page, limit };
}

/**
 * Admin: list all tickets with optional filters (logs ADMIN_TICKETS_VIEWED).
 */
async function adminListTickets({ adminId, status, priority, category, role, page = 1, limit = 50 } = {}) {
  const where = {};
  if (role === 'RIDER' || role === 'DRIVER') where.user = { role }; // separate lists for riders and drivers
  if (status)   where.status   = status;
  if (priority) where.priority = priority;
  if (category) where.category = category;

  const skip = (page - 1) * limit;
  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, role: true } },
        messages: { orderBy: { createdAt: 'asc' } }
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      skip, take: limit
    }),
    prisma.supportTicket.count({ where })
  ]);

  await prisma.auditLog.create({
    data: {
      userId:     adminId,
      action:     'ADMIN_TICKETS_VIEWED',
      entityType: 'SUPPORT_TICKET',
      entityId:   null,
      details:    { filters: { status, priority, category }, page, limit }
    }
  });

  return { tickets, total, page, limit };
}

module.exports = { createTicket, addTicketMessage, updateTicketStatus, getUserTickets, adminListTickets, VALID_CATEGORIES };

