// ============================================================================
// AAROHAN DISPATCH CONCURRENCY SIMULATION
// 20 Drivers, 5 Riders Concurrent Booking & Atomic Single-Assignment Audit
// Lilongwe, Malawi • PostgreSQL Multi-Tenancy & No Double-Assignment Proof
// ============================================================================

const assert = require('assert');
const prisma = require('../lib/prisma');
const dispatchService = require('../services/dispatch');
const { getTestToken } = require('./auth_helper');
const { server } = require('../server');

const BASE_URL = 'http://localhost:3000';

async function runConcurrencySimulation() {
  if (!server.listening) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(3000, '0.0.0.0', resolve);
      });
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }

  console.log('=============================================================');
  console.log('   AAROHAN 20-DRIVER & 5-RIDER CONCURRENCY DISPATCH SUITE');
  console.log('   Lilongwe, Malawi • Atomic Single Assignment & No Double-Booking');
  console.log('=============================================================\n');

  let passed = 0;
  let total = 0;

  function report(name, condition, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      if (details) console.log(`   └─ ${details}`);
    } else {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      if (details) console.error(`   └─ ${details}`);
    }
  }

  // -------------------------------------------------------------------------
  // Phase 1: Provision 20 Verified Drivers in Lilongwe Corridor
  // -------------------------------------------------------------------------
  console.log('--- Phase 1: Provisioning 20 Database Drivers (APPROVED + ONLINE + Fresh GPS) ---');
  const drivers = [];
  const baseLat = -13.9700;
  const baseLng = 33.7650;

  for (let i = 1; i <= 20; i++) {
    const pad = String(i).padStart(3, '0');
    const phone = `+26599000${pad}`;
    const driverUser = await prisma.user.upsert({
      where: { phone },
      update: { role: 'DRIVER', status: 'ACTIVE' },
      create: {
        phone,
        name: `Captain Fleet ${i}`,
        role: 'DRIVER',
        status: 'ACTIVE',
        wallet: { create: { balanceMWK: 100000 } }
      }
    });

    const driverProfile = await prisma.driver.upsert({
      where: { userId: driverUser.id },
      update: {
        approvalStatus: 'APPROVED',
        availability: 'ONLINE',
        currentLat: baseLat + (i * 0.001),
        currentLng: baseLng + (i * 0.001),
        currentHeading: 90,
        lastLocationAt: new Date(),
        rating: 4.9
      },
      create: {
        userId: driverUser.id,
        approvalStatus: 'APPROVED',
        availability: 'ONLINE',
        currentLat: baseLat + (i * 0.001),
        currentLng: baseLng + (i * 0.001),
        currentHeading: 90,
        lastLocationAt: new Date(),
        rating: 4.9
      }
    });

    await prisma.vehicle.upsert({
      where: { driverId: driverProfile.id },
      update: {
        type: 'CAB',
        plateNumber: `MW-SIM-${pad}`,
        makeModel: `Toyota Passo Edition ${i}`,
        color: 'White'
      },
      create: {
        driverId: driverProfile.id,
        type: 'CAB',
        plateNumber: `MW-SIM-${pad}`,
        makeModel: `Toyota Passo Edition ${i}`,
        color: 'White'
      }
    });

    drivers.push({ user: driverUser, profile: driverProfile });
  }

  report(
    '20 active fleet drivers provisioned in PostgreSQL with approved status & fresh coordinates',
    drivers.length === 20,
    `Provisioned ${drivers.length} drivers: ${drivers[0].user.phone} through ${drivers[19].user.phone}`
  );

  // -------------------------------------------------------------------------
  // Phase 2: Provision 5 Independent Riders
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 2: Provisioning 5 Active Riders in PostgreSQL ---');
  const riders = [];
  for (let i = 1; i <= 5; i++) {
    const pad = String(i).padStart(3, '0');
    const phone = `+26588000${pad}`;
    const riderUser = await prisma.user.upsert({
      where: { phone },
      update: { role: 'RIDER', status: 'ACTIVE' },
      create: {
        phone,
        name: `Rider Sim ${i}`,
        role: 'RIDER',
        status: 'ACTIVE',
        wallet: { create: { balanceMWK: 50000 } }
      }
    });

    // Clear active trips for this rider to prevent partial unique index constraint violations
    await prisma.trip.updateMany({
      where: { riderId: riderUser.id, status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] } },
      data: { status: 'CANCELLED_BY_RIDER', cancelledAt: new Date() }
    });

    riders.push(riderUser);
  }

  report(
    '5 independent riders provisioned with active wallets & clear active trip slots',
    riders.length === 5,
    `Provisioned 5 riders: ${riders.map(r => r.phone).join(', ')}`
  );

  // -------------------------------------------------------------------------
  // Phase 3: Concurrent Trip Creation & Dispatch Offering
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 3: Concurrently Creating 5 Trip Bookings & Initiating Dispatch ---');
  const tripPromises = riders.map(async (rider, idx) => {
    const trip = await prisma.trip.create({
      data: {
        riderId: rider.id,
        status: 'REQUESTED',
        tier: 'CAB',
        pickupAddress: `Pickup Point ${idx + 1}`,
        dropoffAddress: `Destination Hub ${idx + 1}`,
        pickupLat: baseLat + (idx * 0.002),
        pickupLng: baseLng + (idx * 0.002),
        dropoffLat: baseLat + 0.03,
        dropoffLng: baseLng + 0.03,
        distanceKm: 4.5,
        durationMins: 11,
        fareMWK: 4500,
        baseFareMWK: 2800,
        driverShareMWK: 3150,
        commissionMWK: 1350,
        pin: String(1000 + idx),
        idempotencyKey: `CONC-SIM-${rider.id}-${Date.now()}`,
        paymentMethod: 'CASH'
      }
    });

    // Initiate dispatch queue (offers to nearest driver)
    await dispatchService.startDispatch(trip.id);
    return trip;
  });

  const createdTrips = await Promise.all(tripPromises);

  report(
    '5 distinct trips created in PostgreSQL concurrently and queued in dispatchService',
    createdTrips.length === 5 && createdTrips.every(t => t.id),
    `Trip IDs: ${createdTrips.map(t => t.id.slice(0, 8)).join(', ')}`
  );

  // -------------------------------------------------------------------------
  // Phase 4: 20 Drivers Race to Accept the 5 Trips Concurrently
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 4: Simulating 20 Drivers Racing Concurrently to Accept 5 Trips ---');
  
  // Every driver attempts to accept all 5 trips concurrently in a massive race
  const raceResults = [];
  const acceptPromises = [];

  for (const driver of drivers) {
    for (const trip of createdTrips) {
      acceptPromises.push(
        (async () => {
          try {
            const result = await dispatchService.acceptTrip(trip.id, driver.profile.id);
            raceResults.push({ success: true, tripId: trip.id, driverId: driver.profile.id });
          } catch (err) {
            raceResults.push({ success: false, tripId: trip.id, driverId: driver.profile.id, error: err.message });
          }
        })()
      );
    }
  }

  await Promise.all(acceptPromises);

  const successfulAccepts = raceResults.filter(r => r.success);

  report(
    'Concurrent race settled: exactly 5 total successful acceptances across the 5 trips',
    successfulAccepts.length === 5,
    `Total attempts: ${raceResults.length} • Successful: ${successfulAccepts.length} • Rejected collisions: ${raceResults.length - successfulAccepts.length}`
  );

  // -------------------------------------------------------------------------
  async function withRetry(fn, retries = 4, delayMs = 1500) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isConnDrop = err.code === 'P1017' || (err.message && err.message.includes('Server has closed the connection'));
        if (attempt === retries || !isConnDrop) {
          throw err;
        }
        await new Promise(res => setTimeout(res, delayMs * attempt));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 5: Rigorous Invariant Assertions (No Double Assignment)
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 5: Validating Zero Double-Assignment Invariants in PostgreSQL ---');

  const updatedTrips = await withRetry(() => prisma.trip.findMany({
    where: { id: { in: createdTrips.map(t => t.id) } },
    include: { offers: true }
  }));

  // Invariant 1: Every trip has a non-null driverId
  const allAssigned = updatedTrips.every(t => t.driverId != null && t.status === 'DRIVER_ARRIVING');
  report(
    'Every trip is assigned to a driver with status DRIVER_ARRIVING in database',
    allAssigned,
    `Statuses: ${updatedTrips.map(t => t.status).join(', ')}`
  );

  // Invariant 2: NO DOUBLE ASSIGNMENT (All 5 assigned driver IDs are strictly unique)
  const assignedDriverIds = updatedTrips.map(t => t.driverId);
  const uniqueAssignedDriverIds = new Set(assignedDriverIds);

  report(
    'NO DOUBLE ASSIGNMENT: Exactly 5 unique drivers assigned across 5 distinct trips',
    uniqueAssignedDriverIds.size === 5,
    `Assigned Drivers Count: ${uniqueAssignedDriverIds.size} / 5 unique drivers. IDs: ${[...uniqueAssignedDriverIds].map(id => id.slice(0, 8)).join(', ')}`
  );

  // Invariant 3: The 5 assigned drivers have availability BUSY
  const assignedDriversInDb = await withRetry(() => prisma.driver.findMany({
    where: { id: { in: assignedDriverIds } }
  }));
  const allAssignedBusy = assignedDriversInDb.every(d => d.availability === 'BUSY');
  report(
    'All 5 winning drivers transitioned availability to BUSY in PostgreSQL',
    allAssignedBusy,
    `Availabilities: ${assignedDriversInDb.map(d => d.availability).join(', ')}`
  );

  // Invariant 4: The other 15 unassigned drivers remain ONLINE
  const unassignedDrivers = drivers.filter(d => !uniqueAssignedDriverIds.has(d.profile.id));
  const unassignedInDb = await withRetry(() => prisma.driver.findMany({
    where: { id: { in: unassignedDrivers.map(d => d.profile.id) } }
  }));
  const allUnassignedOnline = unassignedInDb.every(d => d.availability === 'ONLINE');
  report(
    'All remaining 15 unassigned fleet drivers remain ONLINE and available for new dispatches',
    unassignedInDb.length === 15 && allUnassignedOnline,
    `Free Drivers: ${unassignedInDb.length} • All ONLINE: ${allUnassignedOnline}`
  );

  // Invariant 5: Exactly ONE offer per trip is marked ACCEPTED in database
  const offersAcceptedPerTrip = updatedTrips.map(t => t.offers.filter(o => o.status === 'ACCEPTED').length);
  const exactlyOneAcceptedOfferPerTrip = offersAcceptedPerTrip.every(count => count === 1);
  report(
    'PostgreSQL TripOffer table records exactly ONE ACCEPTED offer per trip',
    exactlyOneAcceptedOfferPerTrip,
    `Accepted offers per trip: [${offersAcceptedPerTrip.join(', ')}]`
  );

  // Invariant 6: A 21st driver attempting to accept an already-accepted trip is strictly rejected
  let lateCollisionRejected = false;
  try {
    const unassignedDriver = unassignedDrivers[0];
    await dispatchService.acceptTrip(createdTrips[0].id, unassignedDriver.profile.id);
  } catch (err) {
    lateCollisionRejected = err.message.includes('Trip already accepted by another driver') ||
                            err.message.includes('Trip is no longer available');
  }

  report(
    'Late driver collision strictly rejected by PostgreSQL atomic update (P2002 / condition guard)',
    lateCollisionRejected,
    'Attempt to hijack accepted trip threw atomic rejection'
  );

  console.log('\n=============================================================');
  console.log(`CONCURRENCY AUDIT RESULT: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('=============================================================\n');

  return { passed, total, success: passed === total };
}

if (require.main === module) {
  runConcurrencySimulation()
    .then(summary => {
      process.exit(summary.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal concurrency simulation error:', err);
      process.exit(1);
    });
}

module.exports = { runConcurrencySimulation };
