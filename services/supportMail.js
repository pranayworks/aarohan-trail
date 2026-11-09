// ============================================================================
// Support emails: new ticket -> the Aarohan help inbox, confirmation -> the person, staff reply -> the person.
// Best effort: a failed email never blocks the ticket itself (it is logged).
// ============================================================================
const prisma = require('../lib/prisma');
const emailService = require('./email');

const inbox = () => (process.env.SUPPORT_EMAIL || process.env.CONTACT_EMAIL || 'aarohan.help@gmail.com').trim();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const who = (u) => (u && u.role === 'DRIVER' ? 'Driver' : 'Rider');
const STAFF = ['ADMIN', 'SUPPORT', 'FINANCE'];

async function safeSend(args) {
  try { await emailService.sendEmail(args); return true; }
  catch (err) { console.warn('[SupportMail] email not sent:', err.message); return false; }
}
async function userOf(id) {
  try { return prisma.user && prisma.user.findUnique ? await prisma.user.findUnique({ where: { id } }) : null; } catch (_) { return null; }
}

async function onTicketCreated(ticket) {
  const u = await userOf(ticket.userId);
  const kind = who(u);
  const lines = [`${kind} ticket: ${ticket.subject}`, `Category: ${ticket.category}`, `From: ${u ? (u.name || 'Unnamed') : 'Unknown'} (${u ? (u.email || 'no email') : ''}, ${u ? u.phone : ''})`, ticket.tripId ? `Trip: ${ticket.tripId}` : 'Trip: none', `Ticket: ${ticket.id}`, '', ticket.description];
  await safeSend({ purpose: 'SUPPORT_TICKET_STAFF', to: inbox(), subject: `[${kind} ticket] ${ticket.subject}`, text: lines.join('\n'), html: `<p><b>${esc(kind)} ticket:</b> ${esc(ticket.subject)}</p><p>Category: ${esc(ticket.category)}<br>From: ${esc(u && u.name)} (${esc(u && u.email)}, ${esc(u && u.phone)})<br>Trip: ${esc(ticket.tripId || 'none')}<br>Ticket: ${esc(ticket.id)}</p><p>${esc(ticket.description).replace(/\n/g, '<br>')}</p>` });
  if (u && u.email) {
    await safeSend({ purpose: 'SUPPORT_TICKET_RECEIPT', to: u.email, subject: `We got your ticket: ${ticket.subject}`, text: `Hello ${u.name || ''},\n\nWe received your ticket "${ticket.subject}". Our team will reply in the Aarohan app and by email.\n\nAarohan Support`, html: `<p>Hello ${esc(u.name || '')},</p><p>We received your ticket <b>${esc(ticket.subject)}</b>. Our team will reply in the Aarohan app and by email.</p><p>Aarohan Support</p>` });
  }
}

// Staff reply -> email the ticket owner. Rider/driver reply -> email the help inbox.
async function onTicketMessage({ ticket, authorRole, body }) {
  const owner = await userOf(ticket.userId);
  if (STAFF.includes(authorRole)) {
    if (owner && owner.email) await safeSend({ purpose: 'SUPPORT_TICKET_REPLY', to: owner.email, subject: `Reply to your ticket: ${ticket.subject}`, text: `Hello ${owner.name || ''},\n\nAarohan Support replied to "${ticket.subject}":\n\n${body}\n\nOpen the Aarohan app to reply.`, html: `<p>Hello ${esc(owner.name || '')},</p><p>Aarohan Support replied to <b>${esc(ticket.subject)}</b>:</p><blockquote>${esc(body).replace(/\n/g, '<br>')}</blockquote><p>Open the Aarohan app to reply.</p>` });
  } else {
    await safeSend({ purpose: 'SUPPORT_TICKET_STAFF', to: inbox(), subject: `[${who(owner)} reply] ${ticket.subject}`, text: `${owner ? owner.name : 'A user'} replied on ticket ${ticket.id}:\n\n${body}` });
  }
}

// A driver finished their application: tell the team so it can be reviewed. No ID numbers are emailed.
async function onDriverSubmitted({ driver, user }) {
  const plate = driver.vehicle ? driver.vehicle.plateNumber : 'unknown plate';
  const lines = ['A driver application is ready for review.', `Name: ${user.name || 'Unnamed'}`, `Phone: ${user.phone || ''}`, `Vehicle: ${driver.vehicle ? driver.vehicle.type + ', ' + driver.vehicle.makeModel : ''} (${plate})`, '', 'Open the Aarohan admin panel, Drivers, Pending, to review the documents and complete the checklist.'];
  await safeSend({ purpose: 'DRIVER_APPLICATION_STAFF', to: inbox(), subject: `[Driver application] ${user.name || 'New driver'} (${plate})`, text: lines.join('\n'), html: '<p>' + lines.map(esc).join('<br>') + '</p>' });
  if (user.email) await safeSend({ purpose: 'DRIVER_APPLICATION_RECEIPT', to: user.email, subject: 'We received your Aarohan driver application', text: `Hello ${user.name || ''},\n\nYour documents were uploaded successfully and our team is verifying them. Verification is completed within 24 hours, so please be patient. We will notify you as soon as it is done.\n\nAarohan Team`, html: `<p>Hello ${esc(user.name || '')},</p><p>Your documents were uploaded successfully and our team is verifying them. Verification is completed within 24 hours, so please be patient. We will notify you as soon as it is done.</p><p>Aarohan Team</p>` });
}

async function onDriverApproved({ user }) {
  if (!user || !user.email) return;
  await safeSend({ purpose: 'DRIVER_APPROVED', to: user.email, subject: 'You are approved to drive with Aarohan', text: `Hello ${user.name || ''},\n\nGood news: your driver application has been approved. Open the Aarohan Captain app, go online, and start earning.\n\nAarohan Team`, html: `<p>Hello ${esc(user.name || '')},</p><p>Good news: your driver application has been approved. Open the Aarohan Captain app, go online, and start earning.</p><p>Aarohan Team</p>` });
}

module.exports = { onTicketCreated, onTicketMessage, onDriverSubmitted, onDriverApproved, inbox };
