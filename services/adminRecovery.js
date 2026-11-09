// ============================================================================
// ONE-TIME ADMIN PASSWORD SET (no terminal needed)
// If BOTH variables below are set in the hosting dashboard, then at start-up:
//   ADMIN_RECOVERY_EMAIL     the admin's email address
//   ADMIN_RECOVERY_PASSWORD  the new password (10+ characters, letters and a number)
// the matching ADMIN account gets that password. If no account has that email and
// ADMIN_RECOVERY_PHONE (+265XXXXXXXXX) is also set, an admin account is created.
// It never touches riders or drivers. REMOVE the variables after it has worked.
// ============================================================================
'use strict';
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');

async function run() {
  const email = String(process.env.ADMIN_RECOVERY_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_RECOVERY_PASSWORD || '';
  if (!email || !password) return { ran: false };
  const { validateNewPassword } = require('./emailAuth');
  try { validateNewPassword(password, email); } catch (e) { console.warn('[AdminRecovery] password refused: ' + e.message); return { ran: false, error: e.message }; }
  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findFirst({ where: { email } });
  let userId;
  if (existing) {
    if (existing.role !== 'ADMIN') { console.warn('[AdminRecovery] that email belongs to a non-admin account. Nothing changed.'); return { ran: false }; }
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, status: 'ACTIVE' } });
    await prisma.refreshToken.deleteMany({ where: { userId: existing.id } }).catch(() => {});
    userId = existing.id;
  } else {
    const phone = String(process.env.ADMIN_RECOVERY_PHONE || '').trim();
    if (!/^\+265\d{9}$/.test(phone)) { console.warn('[AdminRecovery] no admin has that email. Set ADMIN_RECOVERY_PHONE (+265...) to create one.'); return { ran: false }; }
    const created = await prisma.user.upsert({
      where: { phone },
      create: { phone, email, name: 'Aarohan Operations Admin', role: 'ADMIN', status: 'ACTIVE', passwordHash, kycTier: 'TIER_3_ADMIN' },
      update: { email, role: 'ADMIN', status: 'ACTIVE', passwordHash, kycTier: 'TIER_3_ADMIN' }
    });
    await prisma.wallet.upsert({ where: { userId: created.id }, create: { userId: created.id, balanceMWK: 0 }, update: {} });
    userId = created.id;
  }
  await prisma.auditLog.create({ data: { user: { connect: { id: userId } }, action: 'PROFILE_UPDATED', entityType: 'USER', entityId: userId, details: { event: 'ADMIN_RECOVERY_VARIABLE_USED' } } }).catch(() => {});
  console.log('[AdminRecovery] Admin password set for ' + email.replace(/^(.).*(@.*)$/, '$1***$2') + '. Now REMOVE ADMIN_RECOVERY_* from the hosting variables.');
  return { ran: true };
}
module.exports = { run };
