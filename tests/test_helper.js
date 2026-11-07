// ============================================================================
// AAROHAN TEST ISOLATION & DATABASE SAFETY HELPER
// Lilongwe, Malawi • Multi-Tenant Test Isolation & Environment Guard
// ============================================================================

const crypto = require('crypto');

/**
 * Asserts that tests are not running against a database named like production.
 * Supports DATABASE_URL_TEST if provided.
 */
function assertSafeTestDatabase() {
  if (process.env.DATABASE_URL_TEST) {
    process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  }

  const activeUrl = process.env.DATABASE_URL || '';
  const lowerUrl = activeUrl.toLowerCase();

  const dangerousKeywords = ['prod', 'production', 'live', 'real'];
  for (const kw of dangerousKeywords) {
    // Check if the host, database name, or connection string contains production keywords
    if (lowerUrl.includes(`/${kw}`) || lowerUrl.includes(`-${kw}`) || lowerUrl.includes(`_${kw}`) || lowerUrl.includes(`${kw}.`)) {
      throw new Error(`SAFETY VIOLATION: Refusing to run tests! Target database name contains "${kw}" (URL: ${activeUrl.replace(/:[^:@]+@/, ':***@')})`);
    }
  }

  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_TESTS_IN_PRODUCTION) {
    throw new Error('SAFETY VIOLATION: Refusing to run tests when NODE_ENV=production!');
  }
}

// Known test phone patterns used across suites
const DEFAULT_TEST_PHONE_PREFIXES = [
  '+26599000', // Concurrency simulation fleet drivers
  '+26588000', // Concurrency simulation riders
  '+26599111', // Rate limit test numbers
  '+26588111',
  '+2659900000', // Sequential dispatch test drivers
  '+265991234567', // Standard test rider
  '+265881234567'
];

/**
 * Clean up active trips and reset driver state for specified test users/drivers
 * to prevent cross-test interference and leftovers in dev database.
 */
async function cleanTestState(prisma, options = {}) {
  assertSafeTestDatabase();

  const {
    phones = [],
    userIds = [],
    driverIds = [],
    resetDriverDebt = true,
    targetAvailability = 'ONLINE'
  } = options;

  try {
    // 1. Resolve users to clean
    const phoneList = [...new Set([...phones])];
    const whereConditions = [];

    if (phoneList.length > 0) {
      whereConditions.push({ phone: { in: phoneList } });
    }
    if (userIds.length > 0) {
      whereConditions.push({ id: { in: userIds } });
    }

    // Default to cleaning active trips on test phone prefixes if no explicit targets given
    if (whereConditions.length === 0) {
      whereConditions.push(
        { phone: { startsWith: '+26599000' } },
        { phone: { startsWith: '+26588000' } },
        { phone: { startsWith: '+26599111' } },
        { phone: { startsWith: '+26588111' } }
      );
    }

    const matchedUsers = await prisma.user.findMany({
      where: { OR: whereConditions },
      select: { id: true, role: true, phone: true }
    });

    const targetUserIds = matchedUsers.map(u => u.id);
    const matchedDrivers = await prisma.driver.findMany({
      where: {
        OR: [
          ...(targetUserIds.length > 0 ? [{ userId: { in: targetUserIds } }] : []),
          ...(driverIds.length > 0 ? [{ id: { in: driverIds } }] : [])
        ]
      },
      select: { id: true }
    });
    const targetDriverIds = matchedDrivers.map(d => d.id);

    // 2. Cancel any pending or in-flight active trips for these riders or drivers
    const activeStatuses = ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'];
    const tripFilter = [];
    if (targetUserIds.length > 0) {
      tripFilter.push({ riderId: { in: targetUserIds } });
    }
    if (targetDriverIds.length > 0) {
      tripFilter.push({ driverId: { in: targetDriverIds } });
    }

    if (tripFilter.length > 0) {
      await prisma.trip.updateMany({
        where: {
          OR: tripFilter,
          status: { in: activeStatuses }
        },
        data: {
          status: 'CANCELLED_BY_RIDER',
          cancelledAt: new Date()
        }
      });
    }

    // 3. Reset driver commission debt and availability
    if (resetDriverDebt && targetDriverIds.length > 0) {
      await prisma.driver.updateMany({
        where: { id: { in: targetDriverIds } },
        data: {
          commissionDebtMWK: 0,
          availability: targetAvailability
        }
      });
    }
  } catch (err) {
    // If DB connection fails or table missing in mock, don't crash the test runner
    console.warn('[TestIsolation] Cleanup warning:', err.message);
  }
}

/**
 * Setup hook: runs safety assertion and clears test leftovers
 */
async function setupTestIsolation(prisma, options = {}) {
  assertSafeTestDatabase();
  await cleanTestState(prisma, options);
}

/**
 * Teardown hook: cleans up test leftovers created during the test run
 */
async function teardownTestIsolation(prisma, options = {}) {
  await cleanTestState(prisma, options);
}

module.exports = {
  assertSafeTestDatabase,
  cleanTestState,
  setupTestIsolation,
  teardownTestIsolation
};

