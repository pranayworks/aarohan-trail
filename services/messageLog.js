// A log of every email, push notification and SMS the platform sends, so the admin panel can show it.
// Only a masked address is kept, never the message body (it may contain a login code).
const prisma = require('../lib/prisma');

function mask(channel, to) {
  const v = String(to || '');
  if (channel === 'EMAIL') { const [l = '', d = ''] = v.split('@'); return `${l.slice(0, 1)}***@${d.slice(0, 1)}***${d.slice(d.lastIndexOf('.')) || ''}`; }
  if (channel === 'SMS') return v.length > 4 ? v.slice(0, 4) + '****' + v.slice(-3) : '****';
  return v || 'device';
}

async function log({ channel, purpose, to, userId, subject, status, provider, error }) {
  try {
    if (!prisma.messageLog || !prisma.messageLog.create) return;
    await prisma.messageLog.create({ data: {
      channel, purpose: String(purpose || 'GENERAL').slice(0, 60), toMasked: mask(channel, to), userId: userId || null,
      subject: subject ? String(subject).slice(0, 140) : null, status, provider: provider || null, error: error ? String(error).slice(0, 200) : null
    } });
  } catch (_) { /* logging must never break sending */ }
}

module.exports = { log, mask };
