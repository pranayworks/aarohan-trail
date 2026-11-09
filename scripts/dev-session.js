// ============================================================================
// DEVELOPMENT ONLY: creates ready-made sign-in sessions for the demo rider and the demo driver
// so every screen can be tested while signed in (without waiting for email codes).
//
//   node scripts/dev-session.js
//
// Writes .dev-sessions.json (git-ignored). Delete that file when you are done testing.
// Refuses to run unless NODE_ENV=development. Never prints the tokens.
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

const RIDER_PHONE = process.env.DEV_RIDER_PHONE || '+265991234567';
const DRIVER_PHONE = process.env.DEV_DRIVER_PHONE || '+265995541122';

async function makeSession(phone, label) {
  const user = await prisma.user.findUnique({ where: { phone }, include: { driverProfile: true } });
  if (!user) throw new Error(`${label} (${phone}) was not found in this database.`);
  if (user.status !== 'ACTIVE') throw new Error(`${label} account is ${user.status}.`);
  const accessToken = authService.issueAccessToken(user);
  const { rawRefreshToken } = await authService.issueRefreshToken(user.id, 'dev-session', '127.0.0.1');
  return {
    accessToken,
    refreshToken: rawRefreshToken,
    user: {
      id: user.id,
      email: user.email || null,
      phone: user.phone,
      name: user.name,
      role: user.role,
      status: user.status,
      driverProfile: user.driverProfile
        ? { id: user.driverProfile.id, approvalStatus: user.driverProfile.approvalStatus, availability: user.driverProfile.availability }
        : null
    }
  };
}

(async () => {
  try {
    const rider = await makeSession(RIDER_PHONE, 'Demo rider');
    const driver = await makeSession(DRIVER_PHONE, 'Demo driver');
    const file = path.join(__dirname, '..', '.dev-sessions.json');
    fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), rider, driver }, null, 2));
    console.log('Wrote .dev-sessions.json (rider: ' + rider.user.name + ', driver: ' + driver.user.name + ').');
    console.log('This file is git-ignored. Delete it when you are done testing.');
    process.exit(0);
  } catch (err) {
    console.error('Could not create the sessions:', err.message);
    process.exit(1);
  }
})();
