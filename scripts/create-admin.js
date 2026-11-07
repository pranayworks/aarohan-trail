// ============================================================================
// AAROHAN ADMIN PROVISIONING CLI SCRIPT • PRODUCTION READY
// ============================================================================
// Creates or updates an administrative user in PostgreSQL.
// Interactive CLI prompts for phone, full name, and secure password.
// Password is never echoed to stdout, never logged, and never seeded.
// Works against an empty production database.
// ============================================================================

require('dotenv').config();
const readline = require('readline');
const { Writable } = require('stream');
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

function askHiddenQuestion(query) {
  let muted = false;
  const mutableStdout = new Writable({
    write: function (chunk, encoding, callback) {
      if (!muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true
  });

  return new Promise((resolve) => {
    process.stdout.write(query);
    muted = true;
    rl.question('', (ans) => {
      muted = false;
      process.stdout.write('\n');
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function createAdmin() {
  console.log('=============================================================');
  console.log('   AAROHAN PLATFORM • PRODUCTION ADMIN PROVISIONING');
  console.log('   Lilongwe, Malawi • Zero-Leakage Credential Setup');
  console.log('=============================================================\n');

  // Verify DB connectivity before proceeding
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (dbErr) {
    console.error('❌ Error: Could not connect to the database.');
    console.error(`   Details: ${dbErr.message}`);
    process.exit(1);
  }

  // 1. Phone prompt
  let phone = process.env.ADMIN_PHONE;
  if (!phone) {
    phone = await askQuestion('Enter Admin Mobile Number (+265XXXXXXXXX): ');
  }

  if (!phone) {
    console.error('❌ Error: Phone number is required.');
    process.exit(1);
  }

  if (!validateMalawianPhone(phone)) {
    console.error(`❌ Error: Invalid phone number format "${phone}". Must be E.164 Malawian format (+265XXXXXXXXX).`);
    process.exit(1);
  }

  // 1b. Email (required when AUTH_MODE=email, because admins then sign in with an email code)
  let email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    email = (await askQuestion('Enter Admin Email (required when AUTH_MODE=email; press Enter to skip): ')).trim().toLowerCase();
  }
  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
  if (email && !emailOk(email)) {
    console.error(`❌ Error: Invalid email address "${email}".`);
    process.exit(1);
  }
  if (!email && String(process.env.AUTH_MODE || '').toLowerCase() === 'email') {
    console.error('❌ Error: AUTH_MODE=email requires an admin email address.');
    process.exit(1);
  }

  // 2. Name prompt
  let name = await askQuestion('Enter Admin Full Name [Aarohan Operations Admin]: ');
  if (!name) name = 'Aarohan Operations Admin';

  // 3. Password prompt with confirmation (hidden input)
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await askHiddenQuestion('Enter Secure Admin Password (min 10 characters): ');
    if (!password || password.length < 10) {
      console.error('❌ Error: Password must be at least 10 characters long.');
      process.exit(1);
    }

    const confirmPassword = await askHiddenQuestion('Confirm Admin Password: ');
    if (password !== confirmPassword) {
      console.error('❌ Error: Passwords do not match.');
      process.exit(1);
    }
  } else {
    if (password.length < 10) {
      console.error('❌ Error: ADMIN_PASSWORD environment variable must be at least 10 characters long.');
      process.exit(1);
    }
  }

  console.log(`\n⏳ Hashing password securely with bcrypt (cost factor 12)...`);
  const passwordHash = await bcrypt.hash(password, 12);

  console.log(`⏳ Provisioning admin user in database for ${phone}...`);
  const adminUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { phone },
      create: {
        phone,
        ...(email ? { email } : {}),
        name,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
        kycTier: 'TIER_3_ADMIN'
      },
      update: {
        ...(email ? { email } : {}),
        name,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
        kycTier: 'TIER_3_ADMIN'
      }
    });

    // Ensure wallet exists for admin user
    await tx.wallet.upsert({
      where: { userId: user.id },
      create: { userId: user.id, balanceMWK: 0 },
      update: {}
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_REGISTER',
        entityType: 'USER',
        entityId: user.id,
        details: { role: 'ADMIN', provisionedVia: 'CLI_SCRIPT', hasEmail: !!email }
      }
    });

    return user;
  });

  console.log('\n=============================================================');
  console.log('   ✅ PRODUCTION ADMIN PROVISIONED SUCCESSFULLY');
  console.log(`   User ID:   ${adminUser.id}`);
  console.log(`   Name:      ${adminUser.name}`);
  console.log(`   Phone:     ${adminUser.phone}`);
  if (adminUser.email) console.log(`   Email:     ${adminUser.email}`);
  console.log(`   Role:      ${adminUser.role}`);
  console.log(`   Status:    ${adminUser.status}`);
  console.log('   Security:  Password securely hashed & audited in AuditLog');
  console.log('=============================================================\n');
}

if (require.main === module) {
  createAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Failed to provision admin:', err);
      process.exit(1);
    });
}

module.exports = { createAdmin };
