// ============================================================================
// AAROHAN ADMIN PROVISIONING CLI SCRIPT • LILONGWE, MALAWI
// ============================================================================
// Creates or updates an administrative user in PostgreSQL.
// Password is read from prompt or ADMIN_PASSWORD environment variable.
// ============================================================================

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { validateMalawianPhone } = require('../services/auth');

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function createAdmin() {
  console.log('=============================================================');
  console.log('   AAROHAN PLATFORM • ADMIN ACCOUNT PROVISIONING');
  console.log('=============================================================\n');

  let phone = process.env.ADMIN_PHONE;
  if (!phone) {
    phone = await askQuestion('Enter Admin Phone (+265XXXXXXXXX, default: +265999970000): ');
    if (!phone) phone = '+265999970000';
  }

  if (!validateMalawianPhone(phone)) {
    console.error(`❌ Error: Invalid phone number format "${phone}". Must be +265XXXXXXXXX.`);
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askQuestion('Enter Secure Admin Password (min 10 characters): ');
  }

  if (!password || password.length < 10) {
    console.error('❌ Error: Admin password must be at least 10 characters long.');
    process.exit(1);
  }

  console.log(`\n⏳ Hashing password and provisioning admin account for ${phone}...`);
  const passwordHash = await bcrypt.hash(password, 12);

  const adminUser = await prisma.user.upsert({
    where: { phone },
    create: {
      phone,
      name: 'AArohan Operations Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
      kycTier: 'TIER_3_ADMIN'
    },
    update: {
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash
    }
  });

  // Ensure Admin Wallet exists
  await prisma.wallet.upsert({
    where: { userId: adminUser.id },
    create: { userId: adminUser.id, balanceMWK: 0 },
    update: {}
  });

  console.log('\n=============================================================');
  console.log('   ✅ ADMIN PROVISIONED SUCCESSFULLY');
  console.log(`   User ID: ${adminUser.id}`);
  console.log(`   Phone:   ${adminUser.phone}`);
  console.log(`   Role:    ${adminUser.role}`);
  console.log(`   Status:  ${adminUser.status}`);
  console.log('=============================================================\n');
}

createAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Failed to provision admin:', err);
    process.exit(1);
  });
