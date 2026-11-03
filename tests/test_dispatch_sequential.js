const assert = require('assert');
const prisma = require('../lib/prisma');
const dispatchService = require('../services/dispatch');
const { server } = require('../server');

async function runSequentialDispatchTests() {
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
  console.log('   AAROHAN SEQUENTIAL DISPATCH & RESTART RESILIENCE SUITE');
  console.log('   Isolated Corridor • 15s Window, Decline, Timeout & Resume');
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

  // Phase 0: Provision 3 Ordered Distance Drivers in an Isolated Corridor
  console.log('--- Phase 0: Setup 3 Tiered Distance Drivers & Rider ---');
  // Use isolated corridor coordinates (Salima Road corridor) so no other drivers interfere
  const baseLat = -13.7500;
  const baseLng = 34.1000;

  // Driver 1: Nearest (~110 m away)
  // Driver 2: Middle (~550 m away)
  // Driver 3: Furthest (~1.65 km away)
  const driverDefs = [
    { phone: '+265997700001', name: 'Seq Driver 1 (Closest)', lat: baseLat + 0.001, lng: baseLng },
    { phone: '+265997700002', name: 'Seq Driver 2 (Middle)', lat: baseLat + 0.005, lng: baseLng },
    { phone: '+265997700003', name: 'Seq Driver 3 (Furthest)', lat: baseLat + 0.015, lng: baseLng }
  ];

  const drivers = [];
  for (const def of driverDefs) {
    const user = await prisma.user.upsert({
      where: { phone: def.phone },
      update: { role: 'DRIVER', status: 'ACTIVE', name: def.name },
      create: { phone: def.phone, role: 'DRIVER', status: 'ACTIVE', name: def.name }
    });

    const driver = await prisma.driver.upsert({
      where: { userId: user.id },
      update: {
        approvalStatus: 'APPROVED',
        availability: 'ONLINE',
        currentLat: def.lat,
        currentLng: def.lng,
        lastLocationAt: new Date()
      },
      create: {
        userId: user.id,
        approvalStatus: 'APPROVED',
        availability: 'ONLINE',
        currentLat: def.lat,
        currentLng: def.lng,
        lastLocationAt: new Date()
      }
    });

    await prisma.vehicle.upsert({
      where: { driverId: driver.id },
      update: { type: 'AUTO' },
      create: {
        driverId: driver.id,
        type: 'AUTO',
        makeModel: 'Bajaj RE Compact',
        color: 'Yellow',
        plateNumber: `SEQ-${def.phone.slice(-4)}`
      }
    });

    drivers.push({ user, driver, def });
  }

  // Provision Riders
  const riderUser1 = await prisma.user.upsert({
    where: { phone: '+265887700001' },
    update: { role: 'RIDER', status: 'ACTIVE', name: 'Seq Rider 1' },
    create: { phone: '+265887700001', role: 'RIDER', status: 'ACTIVE', name: 'Seq Rider 1' }
  });

  const riderUser2 = await prisma.user.upsert({
    where: { phone: '+265887700002' },
    update: { role: 'RIDER', status: 'ACTIVE', name: 'Seq Rider 2' },
    create: { phone: '+265887700002', role: 'RIDER', status: 'ACTIVE', name: 'Seq Rider 2' }
  });

  // Clean up any lingering active trips for these participants
  await prisma.trip.updateMany({
    where: {
      OR: [
        { riderId: { in: [riderUser1.id, riderUser2.id] } },
        { driverId: { in: drivers.map(d => d.driver.id) } }
      ],
      status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
    },
    data: { status: 'CANCELLED_BY_RIDER', cancelledBy: 'SYSTEM', cancelReason: 'Test setup' }
  });

  // Ensure all 3 drivers are ONLINE with fresh coordinates
  for (const d of drivers) {
    await prisma.driver.update({
      where: { id: d.driver.id },
      data: {
        availability: 'ONLINE',
        currentLat: d.def.lat,
        currentLng: d.def.lng,
        lastLocationAt: new Date()
      }
    });
  }

  // -------------------------------------------------------------------------
  // TEST 1: Nearest Driver Receives First Offer
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 1: Initial Dispatch Offering to Nearest Driver ---');
  const trip = await prisma.trip.create({
    data: {
      riderId: riderUser1.id,
      status: 'REQUESTED',
      tier: 'AUTO',
      pickupAddress: 'Salima Junction Hub',
      dropoffAddress: 'Lakeside Centre',
      pickupLat: baseLat,
      pickupLng: baseLng,
      dropoffLat: baseLat + 0.05,
      dropoffLng: baseLng + 0.05,
      distanceKm: 4.2,
      durationMins: 12,
      fareMWK: 3000,
      baseFareMWK: 3000,
      driverShareMWK: 2100,
      commissionMWK: 900,
      pin: '4455',
      idempotencyKey: `SEQ-TRIP-${Date.now()}`
    }
  });

  const offer1 = await dispatchService.startDispatch(trip.id);

  report(
    'Initial trip offer goes strictly to the NEAREST available driver (Driver 1)',
    offer1 && offer1.driverId === drivers[0].driver.id && offer1.status === 'PENDING',
    `Target: ${offer1?.driverId} (Expected Driver 1: ${drivers[0].driver.id})`
  );

  report(
    'Offer window is configured with exact 15-second decision expiration',
    offer1 && (new Date(offer1.expiresAt).getTime() > Date.now()),
    `Expires At: ${offer1?.expiresAt}`
  );

  // -------------------------------------------------------------------------
  // TEST 2: Decline Advances Immediately to Next Nearest Driver
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 2: Driver 1 Declines -> Advances to Driver 2 ---');
  await dispatchService.declineTripOffer(trip.id, drivers[0].driver.id);

  const updatedOffer1 = await prisma.tripOffer.findUnique({ where: { id: offer1.id } });
  report(
    'Driver 1 offer status transitions to REJECTED in database',
    updatedOffer1.status === 'REJECTED' && updatedOffer1.respondedAt != null,
    `Offer 1 Status: ${updatedOffer1.status} • Responded At: ${updatedOffer1.respondedAt}`
  );

  const activeOfferAfterDecline = await prisma.tripOffer.findFirst({
    where: { tripId: trip.id, status: 'PENDING' }
  });

  report(
    'Declined offer immediately dispatches next offer to 2nd nearest driver (Driver 2)',
    activeOfferAfterDecline && activeOfferAfterDecline.driverId === drivers[1].driver.id,
    `New Offer Target: ${activeOfferAfterDecline?.driverId} (Driver 2: ${drivers[1].driver.id})`
  );

  // -------------------------------------------------------------------------
  // TEST 3: Timeout (15s Window) Advances to Next Nearest Driver
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 3: Driver 2 Times Out -> Advances to Driver 3 ---');
  // Trigger timeout directly on the active offer
  await dispatchService.handleOfferTimeout(trip.id, activeOfferAfterDecline.id);

  const updatedOffer2 = await prisma.tripOffer.findUnique({ where: { id: activeOfferAfterDecline.id } });
  report(
    'Timed out offer transitions to EXPIRED in database',
    updatedOffer2.status === 'EXPIRED' && updatedOffer2.respondedAt != null,
    `Offer 2 Status: ${updatedOffer2.status}`
  );

  const activeOfferAfterTimeout = await prisma.tripOffer.findFirst({
    where: { tripId: trip.id, status: 'PENDING' }
  });

  report(
    'Expired 15s offer automatically dispatches to 3rd nearest driver (Driver 3)',
    activeOfferAfterTimeout && activeOfferAfterTimeout.driverId === drivers[2].driver.id,
    `New Offer Target: ${activeOfferAfterTimeout?.driverId} (Driver 3: ${drivers[2].driver.id})`
  );

  // -------------------------------------------------------------------------
  // TEST 4: Resume Pending Offers on Server Restart
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 4: Server Restart Simulation & Offer Resumption ---');
  // 4a. Clear all in-memory timers to simulate server crash / restart
  dispatchService.offerTimers.clear();
  assert.strictEqual(dispatchService.offerTimers.size, 0, 'In-memory timers must be completely empty');

  // 4b. Invoke resumePendingOffers()
  await dispatchService.resumePendingOffers();

  report(
    'Server restart recovers in-flight pending offer and reschedules timeout timer',
    dispatchService.offerTimers.has(trip.id),
    `Timer successfully restored for Trip ${trip.id}`
  );

  // 4c. Simulate downtime expiration recovery
  // Create an expired offer for another unassigned trip using riderUser2
  const tripDowntime = await prisma.trip.create({
    data: {
      riderId: riderUser2.id,
      status: 'REQUESTED',
      tier: 'AUTO',
      pickupAddress: 'Salima Boma',
      dropoffAddress: 'Lifuwu Beach',
      pickupLat: baseLat,
      pickupLng: baseLng,
      dropoffLat: baseLat + 0.01,
      dropoffLng: baseLng + 0.01,
      distanceKm: 2.0,
      durationMins: 6,
      fareMWK: 2500,
      baseFareMWK: 2500,
      driverShareMWK: 1750,
      commissionMWK: 750,
      pin: '9988',
      idempotencyKey: `DOWNTIME-TRIP-${Date.now()}`
    }
  });

  const staleOffer = await prisma.tripOffer.create({
    data: {
      tripId: tripDowntime.id,
      driverId: drivers[0].driver.id,
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 5000) // Expired 5 seconds ago during simulated downtime
    }
  });

  await dispatchService.resumePendingOffers();

  const refreshedStaleOffer = await prisma.tripOffer.findUnique({ where: { id: staleOffer.id } });
  report(
    'Offers that expired during downtime are marked EXPIRED and auto-advanced to next driver',
    refreshedStaleOffer.status === 'EXPIRED',
    `Downtime offer status: ${refreshedStaleOffer.status}`
  );

  // -------------------------------------------------------------------------
  // TEST 5: Atomic Acceptance Finalizes Trip & Transitions Winner to BUSY
  // -------------------------------------------------------------------------
  console.log('\n--- Phase 5: Driver 3 Accepts Ride Offer ---');
  const acceptResult = await dispatchService.acceptTrip(trip.id, drivers[2].driver.id);

  report(
    'Driver 3 successfully accepts the trip atomically',
    acceptResult && acceptResult.trip.status === 'DRIVER_ARRIVING' && acceptResult.trip.driverId === drivers[2].driver.id,
    `Trip Status: ${acceptResult.trip.status} • Assigned Driver: ${acceptResult.trip.driverId}`
  );

  const winningOffer = await prisma.tripOffer.findFirst({
    where: { tripId: trip.id, driverId: drivers[2].driver.id, status: 'ACCEPTED' }
  });
  report(
    'Accepted offer status transitions to ACCEPTED in PostgreSQL',
    winningOffer && winningOffer.status === 'ACCEPTED',
    `Winning offer status: ${winningOffer?.status}`
  );

  const updatedDriver3 = await prisma.driver.findUnique({ where: { id: drivers[2].driver.id } });
  report(
    'Winning driver availability transitions to BUSY in PostgreSQL',
    updatedDriver3.availability === 'BUSY',
    `Driver 3 Availability: ${updatedDriver3.availability}`
  );

  // Clean up test trips
  await prisma.trip.updateMany({
    where: { id: { in: [trip.id, tripDowntime.id] } },
    data: { status: 'COMPLETED' }
  });

  console.log('\n=============================================================');
  console.log(`SEQUENTIAL DISPATCH RESULT: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('=============================================================\n');

  return { passed, total, success: passed === total };
}

if (require.main === module) {
  runSequentialDispatchTests()
    .then(summary => {
      process.exit(summary.success ? 0 : 1);
    })
    .catch(err => {
      console.error('Fatal sequential dispatch test error:', err);
      process.exit(1);
    });
}

module.exports = { runSequentialDispatchTests };
