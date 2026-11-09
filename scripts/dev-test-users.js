// ============================================================================
// DEVELOPMENT ONLY: creates (or refreshes) a TEST RIDER and an APPROVED TEST DRIVER with a Moto,
// and writes ready-made sign-in sessions for them to .dev-sessions.json (git-ignored).
// Lets every screen and a full ride be tested without waiting for email codes.
//
//   node scripts/dev-test-users.js
//
// Refuses to run unless NODE_ENV=development. Never prints tokens. Delete .dev-sessions.json afterwards.
// ============================================================================
'use strict';
require('dotenv').config();

if (String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'development') {
  console.error('Refusing to run: NODE_ENV must be "development". This helper must never be used in production.');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');

const RIDER = { phone: '+265991000001', email: 'test.rider@aarohan.test', name: 'Test Rider' };
const DRIVER = { phone: '+265991000002', email: 'test.driver@aarohan.test', name: 'Test Driver' };
const common = { status: 'ACTIVE', gender: 'MALE', dateOfBirth: new Date('1995-01-15T00:00:00.000Z') };
const NEWDRIVER = { phone: '+265991000003', email: 'test.newdriver@aarohan.test', name: 'Test New Driver' };

async function ensureWallet(userId) {
  const w = await prisma.wallet.findFirst({ where: { userId } });
  if (!w) await prisma.wallet.create({ data: { userId, balanceMWK: 0 } });
}

async function session(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { driverProfile: true } });
  const accessToken = authService.issueAccessToken(user);
  const { rawRefreshToken } = await authService.issueRefreshToken(user.id, 'dev-test-users', '127.0.0.1');
  return {
    accessToken, refreshToken: rawRefreshToken,
    user: { id: user.id, email: user.email, phone: user.phone, name: user.name, role: user.role, status: user.status,
      driverProfile: user.driverProfile ? { id: user.driverProfile.id, approvalStatus: user.driverProfile.approvalStatus, availability: user.driverProfile.availability } : null }
  };
}

(async () => {
  try {
    // rider
    let rider = await prisma.user.findUnique({ where: { phone: RIDER.phone } });
    if (!rider) rider = await prisma.user.create({ data: { ...RIDER, ...common, role: 'RIDER' } });
    else rider = await prisma.user.update({ where: { id: rider.id }, data: { ...common, role: 'RIDER' } });
    await ensureWallet(rider.id);

    // driver (approved, with a Moto)
    let driver = await prisma.user.findUnique({ where: { phone: DRIVER.phone }, include: { driverProfile: true } });
    if (!driver) driver = await prisma.user.create({ data: { ...DRIVER, ...common, role: 'DRIVER' }, include: { driverProfile: true } });
    else driver = await prisma.user.update({ where: { id: driver.id }, data: { ...common, role: 'DRIVER' }, include: { driverProfile: true } });
    await ensureWallet(driver.id);
    if (!driver.driverProfile) {
      await prisma.driver.create({ data: { userId: driver.id, approvalStatus: 'APPROVED', approvedAt: new Date(), availability: 'OFFLINE',
        vehicle: { create: { type: 'MOTO', makeModel: 'Boxer 150', color: 'Red', plateNumber: 'TEST 001', year: 2021 } } } });
    } else {
      await prisma.driver.update({ where: { id: driver.driverProfile.id }, data: { approvalStatus: 'APPROVED', approvedAt: new Date(), availability: 'OFFLINE', commissionDebtMWK: 0 } });
    }

    // a brand-new person who wants to drive: a plain account with NO driver application (reset on every run)
    let nd = await prisma.user.findUnique({ where: { phone: NEWDRIVER.phone } });
    if (!nd) nd = await prisma.user.create({ data: { ...NEWDRIVER, ...common, role: 'RIDER' } });
    else {
      await prisma.driver.deleteMany({ where: { userId: nd.id } }); // removes the application, documents, face check and vehicle
      nd = await prisma.user.update({ where: { id: nd.id }, data: { ...common, role: 'RIDER', avatarUrl: null } });
    }
    await ensureWallet(nd.id);

    // an existing admin, so the approval step can be tested without typing the admin password
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });

    const out = { createdAt: new Date().toISOString(), rider: await session(rider.id), driver: await session(driver.id), newdriver: await session(nd.id), admin: admin ? await session(admin.id) : null };
    fs.writeFileSync(path.join(__dirname, '..', '.dev-sessions.json'), JSON.stringify(out, null, 2));
    console.log('Done. Test rider: ' + RIDER.email + ' | Test driver: ' + DRIVER.email + ' (approved, Moto, plate TEST 001) | New driver: ' + NEWDRIVER.email + ' (no application yet)' + (out.admin ? ' | Admin session ready' : ' | No admin found'));
    console.log('Wrote .dev-sessions.json (git-ignored). Delete it when you are done testing.');
    process.exit(0);
  } catch (err) {
    console.error('Could not create the test users:', err.message);
    process.exit(1);
  }
})();
