// ============================================================================
// AArohan Smart Urban Mobility • Database Seeding Script
// Lilongwe, Malawi • Runs ONLY when NODE_ENV === 'development'
// ============================================================================

require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../lib/prisma');

const bcrypt = require('bcryptjs');

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

async function main() {
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  if (!isDev) {
    throw new Error('Refusing to run seed: NODE_ENV must be set to "development" or --dev must be passed.');
  }

  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_INITIAL_PASSWORD environment variable is required to seed the admin account.');
  }

  console.log('[Seed] 🌱 Seeding AArohan Lilongwe development database...');

  // 1. Seed Pricing Config (AAROHAN-PRICE-V1)
  const pricingCategories = {
    moto: {
      id: 'moto',
      name: 'AArohan Moto',
      subtitle: 'Fastest through Lilongwe traffic',
      icon: 'two_wheeler',
      capacity: '1 rider',
      baseFare: 800,
      pricePerKm: 250,
      pricePerMinute: 40,
      minimumFare: 1200,
      bookingFee: 100,
      cancellationFee: 500
    },
    auto: {
      id: 'auto',
      name: 'AArohan Auto',
      subtitle: 'Comfortable & sheltered local ride',
      icon: 'electric_rickshaw',
      capacity: '3 riders',
      baseFare: 1400,
      pricePerKm: 450,
      pricePerMinute: 60,
      minimumFare: 2200,
      bookingFee: 150,
      cancellationFee: 800
    },
    cab: {
      id: 'cab',
      name: 'AArohan Cab',
      subtitle: 'Private air-conditioned car',
      icon: 'local_taxi',
      capacity: '4 riders',
      baseFare: 2800,
      pricePerKm: 850,
      pricePerMinute: 120,
      minimumFare: 4500,
      bookingFee: 250,
      cancellationFee: 1500
    }
  };

  await prisma.pricingConfig.upsert({
    where: { versionId: 'AAROHAN-PRICE-V1' },
    update: {
      versionName: 'Lilongwe Standard Urban Mobility Tariffs 2026',
      isActive: true,
      currency: 'MWK',
      commissionRate: 0.30,
      driverShareRate: 0.70,
      roundingUnit: 50,
      bookingFeeMWK: 150,
      waitingChargePerMinMWK: 50,
      freeWaitingMins: 3,
      cancellationFeeMWK: 1000,
      categoryRules: pricingCategories,
      notes: 'Approved launch baseline pricing version for Lilongwe district'
    },
    create: {
      versionId: 'AAROHAN-PRICE-V1',
      versionName: 'Lilongwe Standard Urban Mobility Tariffs 2026',
      isActive: true,
      currency: 'MWK',
      commissionRate: 0.30,
      driverShareRate: 0.70,
      roundingUnit: 50,
      bookingFeeMWK: 150,
      waitingChargePerMinMWK: 50,
      freeWaitingMins: 3,
      cancellationFeeMWK: 1000,
      categoryRules: pricingCategories,
      notes: 'Approved launch baseline pricing version for Lilongwe district'
    }
  });
  console.log('[Seed] ✅ PricingConfig AAROHAN-PRICE-V1 created/updated');

  // 2. Seed Super Admin Account
  const adminUser = await prisma.user.upsert({
    where: { phone: '+265990000001' },
    update: {
      name: 'AArohan System Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: hashPassword(adminPassword)
    },
    create: {
      phone: '+265990000001',
      name: 'AArohan System Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: hashPassword(adminPassword),
      wallet: {
        create: { balanceMWK: 0 }
      }
    }
  });
  console.log('[Seed] ✅ Admin user verified (+265990000001)');

  // 3. Seed Demo Rider (Chisomo Banda)
  const demoRider = await prisma.user.upsert({
    where: { phone: '+265991234567' },
    update: {
      name: 'Chisomo Banda',
      role: 'RIDER',
      status: 'ACTIVE',
      kycTier: 'TIER_1_STANDARD'
    },
    create: {
      phone: '+265991234567',
      name: 'Chisomo Banda',
      role: 'RIDER',
      status: 'ACTIVE',
      kycTier: 'TIER_1_STANDARD',
      wallet: {
        create: { balanceMWK: 38500 }
      }
    },
    include: { wallet: true }
  });

  if (demoRider.wallet) {
    await prisma.wallet.update({
      where: { id: demoRider.wallet.id },
      data: { balanceMWK: 38500 }
    });

    const existingLedger = await prisma.ledgerEntry.findUnique({
      where: { idempotencyKey: 'SEED-OPENING-RIDER-CHISOMO' }
    });
    if (!existingLedger) {
      const journalId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      await prisma.$transaction([
        prisma.ledgerEntry.create({
          data: {
            journalId,
            account: 'RIDER',
            userId: demoRider.id,
            walletId: demoRider.wallet.id,
            type: 'WALLET_TOPUP',
            amountMWK: 38500,
            balanceAfterMWK: 38500,
            currency: 'MWK',
            description: 'Demo opening wallet balance',
            idempotencyKey: 'SEED-OPENING-RIDER-CHISOMO',
            reference: 'DEV_SEED_OPENING_BALANCE'
          }
        }),
        prisma.ledgerEntry.create({
          data: {
            journalId,
            account: 'PLATFORM_ESCROW',
            userId: null,
            walletId: null,
            type: 'WALLET_TOPUP',
            amountMWK: -38500,
            balanceAfterMWK: 0,
            currency: 'MWK',
            description: 'Platform escrow offset for demo opening balance',
            idempotencyKey: 'SEED-OPENING-ESCROW-CHISOMO',
            reference: 'DEV_SEED_OPENING_BALANCE'
          }
        })
      ]);
      console.log('[Seed] ✅ Demo rider zero-sum opening balance ledger created (38,500 MWK)');
    }
  }
  console.log('[Seed] ✅ Demo rider verified (+265991234567, Chisomo Banda)');

  // 3b. Seed Demo Rider 2 (Tionge Mhango)
  const demoRider2 = await prisma.user.upsert({
    where: { phone: '+265992223344' },
    update: {
      name: 'Tionge Mhango',
      role: 'RIDER',
      status: 'ACTIVE',
      kycTier: 'TIER_1_STANDARD'
    },
    create: {
      phone: '+265992223344',
      name: 'Tionge Mhango',
      role: 'RIDER',
      status: 'ACTIVE',
      kycTier: 'TIER_1_STANDARD',
      wallet: {
        create: { balanceMWK: 25000 }
      }
    },
    include: { wallet: true }
  });

  if (demoRider2.wallet) {
    await prisma.wallet.update({
      where: { id: demoRider2.wallet.id },
      data: { balanceMWK: 25000 }
    });

    const existingLedger2 = await prisma.ledgerEntry.findUnique({
      where: { idempotencyKey: 'SEED-OPENING-RIDER-TIONGE' }
    });
    if (!existingLedger2) {
      const journalId2 = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
      await prisma.$transaction([
        prisma.ledgerEntry.create({
          data: {
            journalId: journalId2,
            account: 'RIDER',
            userId: demoRider2.id,
            walletId: demoRider2.wallet.id,
            type: 'WALLET_TOPUP',
            amountMWK: 25000,
            balanceAfterMWK: 25000,
            currency: 'MWK',
            description: 'Demo opening wallet balance for Rider 2',
            idempotencyKey: 'SEED-OPENING-RIDER-TIONGE',
            reference: 'DEV_SEED_OPENING_BALANCE'
          }
        }),
        prisma.ledgerEntry.create({
          data: {
            journalId: journalId2,
            account: 'PLATFORM_ESCROW',
            userId: null,
            walletId: null,
            type: 'WALLET_TOPUP',
            amountMWK: -25000,
            balanceAfterMWK: 0,
            currency: 'MWK',
            description: 'Platform escrow offset for Rider 2 opening balance',
            idempotencyKey: 'SEED-OPENING-ESCROW-TIONGE',
            reference: 'DEV_SEED_OPENING_BALANCE'
          }
        })
      ]);
      console.log('[Seed] ✅ Demo rider 2 zero-sum opening balance ledger created (25,000 MWK)');
    }
  }
  console.log('[Seed] ✅ Demo rider 2 verified (+265992223344, Tionge Mhango)');

  // 4. Seed Demo Drivers
  const demoDrivers = [
    {
      phone: '+265995541122',
      name: 'Chikondi Phiri',
      vehicleType: 'AUTO',
      makeModel: 'White Bajaj RE Compact',
      color: 'White',
      plateNumber: 'BW 4920',
      rating: 4.92,
      tripsCompleted: 1420,
      lat: -13.9650,
      lng: 33.7820,
      balanceMWK: 142800
    },
    {
      phone: '+265998241120',
      name: 'Blessings Phiri',
      vehicleType: 'MOTO',
      makeModel: 'Red Boxer 150',
      color: 'Red',
      plateNumber: 'LL 4920 B',
      rating: 4.95,
      tripsCompleted: 1840,
      lat: -13.9600,
      lng: 33.7850,
      balanceMWK: 65000
    },
    {
      phone: '+265993314455',
      name: 'Tamandani Gondwe',
      vehicleType: 'CAB',
      makeModel: 'Silver Toyota Passo',
      color: 'Silver',
      plateNumber: 'LL 7821 C',
      rating: 4.88,
      tripsCompleted: 980,
      lat: -13.9680,
      lng: 33.7750,
      balanceMWK: 98000
    }
  ];

  for (const drv of demoDrivers) {
    const user = await prisma.user.upsert({
      where: { phone: drv.phone },
      update: {
        name: drv.name,
        role: 'DRIVER',
        status: 'ACTIVE'
      },
      create: {
        phone: drv.phone,
        name: drv.name,
        role: 'DRIVER',
        status: 'ACTIVE',
        wallet: {
          create: { balanceMWK: drv.balanceMWK }
        }
      },
      include: { driverProfile: true, wallet: true }
    });

    if (user.wallet) {
      await prisma.wallet.update({
        where: { id: user.wallet.id },
        data: { balanceMWK: drv.balanceMWK }
      });
    }

    const driverProfile = await prisma.driver.upsert({
      where: { userId: user.id },
      update: {
        approvalStatus: 'APPROVED',
        availability: 'ONLINE',
        rating: drv.rating,
        tripsCompleted: drv.tripsCompleted,
        currentLat: drv.lat,
        currentLng: drv.lng,
        lastLocationAt: new Date()
      },
      create: {
        userId: user.id,
        approvalStatus: 'APPROVED',
        availability: 'ONLINE',
        rating: drv.rating,
        tripsCompleted: drv.tripsCompleted,
        currentLat: drv.lat,
        currentLng: drv.lng,
        lastLocationAt: new Date()
      }
    });

    await prisma.vehicle.upsert({
      where: { driverId: driverProfile.id },
      update: {
        type: drv.vehicleType,
        makeModel: drv.makeModel,
        color: drv.color,
        plateNumber: drv.plateNumber
      },
      create: {
        driverId: driverProfile.id,
        type: drv.vehicleType,
        makeModel: drv.makeModel,
        color: drv.color,
        plateNumber: drv.plateNumber
      }
    });

    console.log(`[Seed] ✅ Demo driver verified (${drv.phone}, ${drv.name}, ${drv.makeModel})`);
  }

  console.log('[Seed] ✨ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('[Seed] ❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
