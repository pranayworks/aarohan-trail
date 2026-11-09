// ============================================================================
// Finish-your-application reminders. Many people start becoming a driver and then stop (the photos take a while). We nudge them
// kindly: an email and a push after 24 hours, then at most every 3 days, at most 3 times in total, and never once they have submitted.
// ============================================================================
const prisma = require('../lib/prisma');

const PURPOSE = 'DRIVER_APPLICATION_REMINDER';
const FIRST_AFTER_MS = 24 * 3600000, GAP_MS = 3 * 86400000, GIVE_UP_AFTER_MS = 21 * 86400000, MAX_REMINDERS = 3;

async function runOnce(now = new Date()) {
  const emailService = require('./email'), push = require('./pushNotification');
  const candidates = await prisma.driver.findMany({
    where: { approvalStatus: 'PENDING', createdAt: { lt: new Date(now.getTime() - FIRST_AFTER_MS), gt: new Date(now.getTime() - GIVE_UP_AFTER_MS) }, OR: [{ kyc: null }, { kyc: { is: { submittedAt: null } } }] },
    include: { user: { select: { id: true, name: true, email: true, status: true } } }, take: 200
  });
  let sent = 0;
  for (const d of candidates) {
    const u = d.user; if (!u || u.status !== 'ACTIVE') continue;
    const past = await prisma.messageLog.findMany({ where: { userId: u.id, purpose: PURPOSE }, select: { createdAt: true } });
    if (past.length >= MAX_REMINDERS) continue;
    if (past.some((m) => now.getTime() - new Date(m.createdAt).getTime() < GAP_MS)) continue;
    const first = (u.name || '').split(' ')[0] || 'there';
    try {
      if (u.email) await emailService.sendEmail({ to: u.email, subject: 'Finish your Aarohan driver application', purpose: PURPOSE, userId: u.id,
        text: `Hello ${first},\n\nYou are almost there. Open Aarohan Captain and finish your application. Your progress is saved, and it takes only a few minutes. Once you submit, our team verifies your documents within 24 hours.\n\nAarohan Team`,
        html: `<p>Hello ${first},</p><p>You are almost there. Open <b>Aarohan Captain</b> and finish your application. Your progress is saved, and it takes only a few minutes. Once you submit, our team verifies your documents within 24 hours.</p><p>Aarohan Team</p>` });
      await push.sendPushToUser(u.id, { title: 'Finish your application', body: 'You are almost there. Your progress is saved.', data: { type: PURPOSE } }).catch(() => {});
      sent++;
    } catch (_) { /* one failed email must not stop the others */ }
  }
  return { checked: candidates.length, sent };
}

// Runs every 6 hours. On the live server by default; on a development computer only when DRIVER_REMINDERS=true.
function start() {
  const on = process.env.DRIVER_REMINDERS ? process.env.DRIVER_REMINDERS === 'true' : process.env.NODE_ENV === 'production';
  if (!on) return null;
  const tick = () => runOnce().then((r) => { if (r.sent) console.log(`[Reminders] Sent ${r.sent} application reminders`); }).catch((e) => console.warn('[Reminders] failed:', e.message));
  setTimeout(tick, 60000);
  return setInterval(tick, 6 * 3600000);
}

module.exports = { runOnce, start, PURPOSE, MAX_REMINDERS };
