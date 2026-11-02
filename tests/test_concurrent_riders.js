// ============================================================================
// AAROHAN CONCURRENT MULTI-TENANCY & LEDGER VERIFICATION SUITE
// Lilongwe, Malawi • PostgreSQL / Prisma / Real Socket.IO Clients
// ============================================================================
// Tests:
//   1. Two concurrent riders requesting trips simultaneously via real Socket.IO
//      - Both trips exist simultaneously in PostgreSQL
//      - Neither overwrites the other
//      - Different PINs, different drivers, no cross-over
//   2. Two drivers accepting the same trip concurrently
//      - Exactly one driver succeeds; the second driver is rejected
//   3. Second active trip rejection
//      - Rider cannot create a second active trip while one is active
//      - Enforced by PostgreSQL partial unique index: unique_active_trip_per_rider
//   4. Stale trips watchdog
//      - Moves REQUESTED/OFFERED trips > 3 mins to NO_DRIVERS/EXPIRED
//      - Unlocks rider so partial unique index never locks them out
//   5. Double-entry ledger integrity
//      - Every wallet/ledger write: one prisma.$transaction, with journalId
//      - Rows sum to strictly 0 MWK per journal
// ============================================================================

require('dotenv').config();
const assert = require('assert');
const ioClient = require('socket.io-client');
const prisma = require('../lib/prisma');
const dbLedger = require('../services/dbLedger');
const { expireStaleTrips, server } = require('../server');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

function connectSocket(userId, role) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE_URL, {
      transports: ['websocket'],
      auth: { userId, role },
      forceNew: true,
      reconnection: false
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket connection timed out for ${userId} (${role})`));
    }, 5000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function runTestSuite() {
  console.log('=============================================================');
  console.log('   AAROHAN CONCURRENCY, DRIVER RACE & LEDGER INTEGRITY SUITE');
  console.log('   Lilongwe, Malawi • PostgreSQL Multi-Tenancy & Zero-Sum Audit');
  console.log('=============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function report(name, condition, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
      if (details) console.log(`   └─ ${details}`);
    } else {
      console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
      if (details) console.error(`   └─ ${details}`);
      throw new Error(`Test assertion failed: ${name}`);
    }
  }

  // Ensure server is listening
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

  // -------------------------------------------------------------------------
  // SETUP: Resolve Riders and Drivers from Database
  // -------------------------------------------------------------------------
  console.log('--- Phase 0: Test Fixture Discovery & State Reset ---');
  const rider1 = await prisma.user.findUnique({ where: { phone: '+265991234567' } });
  const rider2 = await prisma.user.findUnique({ where: { phone: '+265992223344' } });
  const driver1User = await prisma.user.findUnique({
    where: { phone: '+265995541122' },
    include: { driverProfile: true }
  });
  const driver2User = await prisma.user.findUnique({
    where: { phone: '+265998241120' },
    include: { driverProfile: true }
  });

  assert.ok(rider1, 'Rider 1 (+265991234567 Chisomo) must exist in DB');
  assert.ok(rider2, 'Rider 2 (+265992223344 Tionge) must exist in DB');
  assert.ok(driver1User?.driverProfile, 'Driver 1 (+265995541122 Chikondi) must exist in DB');
  assert.ok(driver2User?.driverProfile, 'Driver 2 (+265998241120 Blessings) must exist in DB');

  // Cancel any lingering active trips for these test users to start with clean state
  await prisma.trip.updateMany({
    where: {
      riderId: { in: [rider1.id, rider2.id] },
      status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
    },
    data: { status: 'CANCELLED_BY_RIDER', cancelledBy: 'SYSTEM', cancelReason: 'Test suite setup cleanup' }
  });

  console.log('   Test fixtures verified:');
  console.log(`   - Rider 1: ${rider1.name} (${rider1.id})`);
  console.log(`   - Rider 2: ${rider2.name} (${rider2.id})`);
  console.log(`   - Driver 1: ${driver1User.name} (${driver1User.driverProfile.id})`);
  console.log(`   - Driver 2: ${driver2User.name} (${driver2User.driverProfile.id})\n`);

  // Sockets collection for teardown
  const openSockets = [];

  try {
    // -----------------------------------------------------------------------
    // TEST 1: TWO REAL SOCKET.IO CLIENTS REQUESTING TRIPS SIMULTANEOUSLY
    // -----------------------------------------------------------------------
    console.log('--- TEST 1: Concurrent Trips via Real Socket.IO Clients ---');
    const socketR1 = await connectSocket(rider1.id, 'RIDER');
    const socketR2 = await connectSocket(rider2.id, 'RIDER');
    openSockets.push(socketR1, socketR2);

    const trip1Promise = new Promise((resolve, reject) => {
      socketR1.emit('trip:request', {
        pickup: { name: 'Area 47 Sector 3', lat: -13.9650, lng: 33.7820 },
        destination: { name: 'Gateway Mall', lat: -13.9722, lng: 33.7667 },
        tierId: 'cab',
        fare: 4500,
        baseFare: 4500,
        distanceKm: 6.8,
        durationMins: 18,
        paymentMethod: 'CASH',
        idempotencyKey: `CONCURRENT-REQ-R1-${Date.now()}`
      }, (res) => {
        if (res && res.success) resolve(res.trip);
        else reject(new Error(res?.error || 'Rider 1 request failed'));
      });
    });

    const trip2Promise = new Promise((resolve, reject) => {
      socketR2.emit('trip:request', {
        pickup: { name: 'Capital Hill City Center', lat: -13.9500, lng: 33.7900 },
        destination: { name: 'Old Town Market', lat: -13.9850, lng: 33.7700 },
        tierId: 'moto',
        fare: 2200,
        baseFare: 2200,
        distanceKm: 5.2,
        durationMins: 14,
        paymentMethod: 'WALLET_ESCROW',
        idempotencyKey: `CONCURRENT-REQ-R2-${Date.now()}`
      }, (res) => {
        if (res && res.success) resolve(res.trip);
        else reject(new Error(res?.error || 'Rider 2 request failed'));
      });
    });

    const [t1Created, t2Created] = await Promise.all([trip1Promise, trip2Promise]);

    // Verify both trips exist simultaneously in PostgreSQL
    const dbTrip1 = await prisma.trip.findUnique({ where: { id: t1Created.id } });
    const dbTrip2 = await prisma.trip.findUnique({ where: { id: t2Created.id } });

    report(
      'Two concurrent socket requests create two distinct PostgreSQL rows simultaneously',
      dbTrip1 && dbTrip2 && dbTrip1.id !== dbTrip2.id,
      `Trip 1 ID: ${dbTrip1.id} | Trip 2 ID: ${dbTrip2.id}`
    );

    report(
      'Multi-tenant rider isolation: each trip is strictly bound to its requesting rider',
      dbTrip1.riderId === rider1.id && dbTrip2.riderId === rider2.id,
      `Trip 1 Rider: ${dbTrip1.riderId} | Trip 2 Rider: ${dbTrip2.riderId}`
    );

    report(
      'Safety PINs are distinct and uniquely generated per trip',
      dbTrip1.pin && dbTrip2.pin && dbTrip1.pin !== dbTrip2.pin,
      `Trip 1 PIN: ${dbTrip1.pin} | Trip 2 PIN: ${dbTrip2.pin}`
    );

    report(
      'Trip status history records initial REQUESTED state for both trips',
      (await prisma.tripStatusHistory.count({ where: { tripId: dbTrip1.id, status: 'REQUESTED' } })) === 1 &&
      (await prisma.tripStatusHistory.count({ where: { tripId: dbTrip2.id, status: 'REQUESTED' } })) === 1,
      'Audit rows created in PostgreSQL for both independent bookings'
    );

    // -----------------------------------------------------------------------
    // TEST 2: TWO DRIVERS ACCEPTING THE SAME TRIP CONCURRENTLY
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 2: Two Drivers Accept The Same Trip (Race Collision) ---');
    const socketD1 = await connectSocket(driver1User.id, 'DRIVER');
    const socketD2 = await connectSocket(driver2User.id, 'DRIVER');
    openSockets.push(socketD1, socketD2);

    const targetTripId = dbTrip1.id;

    const acceptDriver1 = new Promise((resolve) => {
      socketD1.emit('trip:accept', {
        tripId: targetTripId,
        driverId: driver1User.driverProfile.id
      }, (res) => resolve({ driver: 'Driver 1', res }));
    });

    const acceptDriver2 = new Promise((resolve) => {
      socketD2.emit('trip:accept', {
        tripId: targetTripId,
        driverId: driver2User.driverProfile.id
      }, (res) => resolve({ driver: 'Driver 2', res }));
    });

    const [d1Result, d2Result] = await Promise.all([acceptDriver1, acceptDriver2]);

    const successes = [d1Result, d2Result].filter(r => r.res && r.res.success);
    const rejections = [d1Result, d2Result].filter(r => r.res && !r.res.success);

    report(
      'Two drivers accept the same trip: exactly ONE succeeds and the other is rejected',
      successes.length === 1 && rejections.length === 1,
      `Winner: ${successes[0]?.driver} | Rejected: ${rejections[0]?.driver} (Error: "${rejections[0]?.res?.error}")`
    );

    const winnerDriverId = successes[0]?.res?.trip?.driverId;
    const finalTrip = await prisma.trip.findUnique({
      where: { id: targetTripId },
      include: { driver: true }
    });

    report(
      'PostgreSQL state reflects exactly ONE assigned driver with status DRIVER_ARRIVING',
      finalTrip.status === 'DRIVER_ARRIVING' && finalTrip.driverId === winnerDriverId,
      `Trip driverId: ${finalTrip.driverId} (Status: ${finalTrip.status})`
    );

    // -----------------------------------------------------------------------
    // TEST 3: SECOND ACTIVE TRIP REJECTION (PARTIAL UNIQUE INDEX)
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 3: Second Active Trip Rejection (Partial Unique Index) ---');
    // Rider 1 already has dbTrip1 active in DRIVER_ARRIVING status
    const secondTripAttempt = await new Promise((resolve) => {
      socketR1.emit('trip:request', {
        pickup: { name: 'Area 47 Sector 4', lat: -13.9680, lng: 33.7840 },
        destination: { name: 'Bingu Stadium', lat: -13.9400, lng: 33.7500 },
        tierId: 'cab',
        fare: 5000,
        baseFare: 5000,
        distanceKm: 7.2,
        durationMins: 20,
        idempotencyKey: `REJECT-SECOND-ACTIVE-${Date.now()}`
      }, (res) => resolve(res));
    });

    report(
      'Rider socket request for a second active trip is rejected by server',
      secondTripAttempt && secondTripAttempt.success === false && secondTripAttempt.error.includes('already has an active trip'),
      `Server response: "${secondTripAttempt?.error}"`
    );

    // Direct database test: attempt to insert a second active trip for Rider 1 via Prisma
    let dbIndexBlocked = false;
    let dbErrorCode = null;
    try {
      await prisma.trip.create({
        data: {
          riderId: rider1.id,
          status: 'REQUESTED',
          tier: 'CAB',
          pickupAddress: 'Area 47',
          dropoffAddress: 'Bingu Stadium',
          pickupLat: -13.9680,
          pickupLng: 33.7840,
          dropoffLat: -13.9400,
          dropoffLng: 33.7500,
          distanceKm: 7.2,
          durationMins: 20,
          fareMWK: 5000,
          baseFareMWK: 5000,
          bookingFeeMWK: 150,
          driverShareMWK: 3500,
          commissionMWK: 1500,
          pin: '9999',
          idempotencyKey: `DIRECT-DB-SECOND-ACTIVE-${Date.now()}`
        }
      });
    } catch (err) {
      dbIndexBlocked = true;
      dbErrorCode = err.code;
    }

    report(
      'PostgreSQL partial unique index unique_active_trip_per_rider strictly throws P2002',
      dbIndexBlocked && dbErrorCode === 'P2002',
      `Prisma database error code: ${dbErrorCode} (Constraint violation prevented double booking)`
    );

    // -----------------------------------------------------------------------
    // TEST 4: STALE TRIPS WATCHDOG (EXPIRES > 3 MIN REQUESTS)
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 4: Stale Trips Expiration Watchdog ---');
    // Create an unaccepted trip for Rider 1 and backdate createdAt to 4 minutes ago
    // First complete or cancel Trip 1 so Rider 1 is free to have a backdated trip
    await prisma.trip.update({
      where: { id: dbTrip1.id },
      data: { status: 'CANCELLED_BY_RIDER', cancelledBy: 'SYSTEM', cancelReason: 'Clean for stale watchdog test' }
    });

    const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000);
    const staleTrip = await prisma.trip.create({
      data: {
        riderId: rider1.id,
        status: 'REQUESTED',
        tier: 'MOTO',
        pickupAddress: 'Old Town',
        dropoffAddress: 'Gateway Mall',
        pickupLat: -13.9850,
        pickupLng: 33.7700,
        dropoffLat: -13.9722,
        dropoffLng: 33.7667,
        distanceKm: 3.8,
        durationMins: 10,
        fareMWK: 1800,
        baseFareMWK: 1800,
        bookingFeeMWK: 150,
        driverShareMWK: 1260,
        commissionMWK: 540,
        pin: '1234',
        createdAt: fourMinutesAgo,
        idempotencyKey: `STALE-TRIP-TEST-${Date.now()}`
      }
    });

    // Run the watchdog job
    const expiredList = await expireStaleTrips();
    const refreshedStaleTrip = await prisma.trip.findUnique({ where: { id: staleTrip.id } });
    const staleAudit = await prisma.tripStatusHistory.findFirst({
      where: { tripId: staleTrip.id, status: 'NO_DRIVERS' }
    });

    report(
      'Stale trips older than 3 minutes automatically transition to NO_DRIVERS',
      refreshedStaleTrip.status === 'NO_DRIVERS' && refreshedStaleTrip.cancelledBy === 'SYSTEM',
      `Trip status: ${refreshedStaleTrip.status} | Cancelled by: ${refreshedStaleTrip.cancelledBy}`
    );

    report(
      'Watchdog writes immutable TripStatusHistory row explaining dispatch timeout',
      staleAudit && staleAudit.fromStatus === 'REQUESTED' && staleAudit.status === 'NO_DRIVERS',
      `Audit reason: "${staleAudit?.reason}"`
    );

    // Verify rider is now unblocked and can book again
    let riderUnblocked = false;
    try {
      const freshTrip = await prisma.trip.create({
        data: {
          riderId: rider1.id,
          status: 'REQUESTED',
          tier: 'CAB',
          pickupAddress: 'Area 47',
          dropoffAddress: 'Gateway Mall',
          pickupLat: -13.9650,
          pickupLng: 33.7820,
          dropoffLat: -13.9722,
          dropoffLng: 33.7667,
          distanceKm: 2.5,
          durationMins: 7,
          fareMWK: 2500,
          baseFareMWK: 2500,
          bookingFeeMWK: 150,
          driverShareMWK: 1750,
          commissionMWK: 750,
          pin: '5566',
          idempotencyKey: `UNBLOCKED-TRIP-${Date.now()}`
        }
      });
      riderUnblocked = Boolean(freshTrip && freshTrip.id);
      // clean up fresh trip
      await prisma.trip.update({ where: { id: freshTrip.id }, data: { status: 'CANCELLED_BY_RIDER' } });
    } catch (e) {
      riderUnblocked = false;
    }

    report(
      'Watchdog expiration successfully unblocks the rider to create a new booking',
      riderUnblocked,
      'Rider active slot liberated without unique index collision'
    );

    // -----------------------------------------------------------------------
    // TEST 5: DOUBLE-ENTRY LEDGER WRITES & ZERO-SUM VERIFICATION
    // -----------------------------------------------------------------------
    console.log('\n--- TEST 5: Double-Entry Ledger Transactions with Zero-Sum Invariant ---');

    // 5A: Wallet Top-Up (Rider + Escrow Legs)
    const topupResult = await dbLedger.recordWalletTopup({
      userId: rider1.id,
      amountMWK: 12000,
      provider: 'AIRTEL_MONEY',
      idempotencyKey: `TEST-TOPUP-${Date.now()}`
    });

    const topupCheck = await dbLedger.verifyJournalBalance(topupResult.journalId);
    report(
      'Wallet top-up executes in one prisma.$transaction and journal rows sum to exactly 0 MWK',
      topupResult.netBalanceSum === 0 && topupCheck.isBalanced && topupCheck.sum === 0,
      `Journal ${topupResult.journalId} (${topupCheck.entryCount} legs) -> Net Sum: ${topupCheck.sum} MWK`
    );

    // 5B: P2P Wallet Transfer (Sender Debit + Recipient Credit Legs)
    const p2pResult = await dbLedger.recordP2PTransfer({
      senderUserId: rider1.id,
      recipientUserId: rider2.id,
      amountMWK: 4000,
      idempotencyKey: `TEST-P2P-${Date.now()}`
    });

    const p2pCheck = await dbLedger.verifyJournalBalance(p2pResult.journalId);
    report(
      'P2P transfer executes in one prisma.$transaction and journal rows sum to exactly 0 MWK',
      p2pResult.netBalanceSum === 0 && p2pCheck.isBalanced && p2pCheck.sum === 0,
      `Journal ${p2pResult.journalId} (${p2pCheck.entryCount} legs) -> Net Sum: ${p2pCheck.sum} MWK`
    );

    // 5C: Settle Completed Ride with Cash (Driver Commission Debt + Platform Revenue)
    // Complete previous active trips to free rider active slots
    await prisma.trip.updateMany({
      where: {
        riderId: { in: [rider1.id, rider2.id] },
        status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
      },
      data: { status: 'COMPLETED' }
    });

    const cashFare = 6000;
    const expectedCashComm = Math.round(cashFare * 0.30); // 1800
    const expectedCashDriverShare = cashFare - expectedCashComm; // 4200

    // Create a completed cash trip fixture
    const cashTripFixture = await prisma.trip.create({
      data: {
        riderId: rider2.id,
        driverId: driver1User.driverProfile.id,
        status: 'IN_TRANSIT',
        tier: 'CAB',
        pickupAddress: 'Area 10',
        dropoffAddress: 'Old Town',
        pickupLat: -13.9600,
        pickupLng: 33.7800,
        dropoffLat: -13.9850,
        dropoffLng: 33.7700,
        distanceKm: 5.0,
        durationMins: 15,
        fareMWK: cashFare,
        baseFareMWK: cashFare,
        bookingFeeMWK: 150,
        driverShareMWK: expectedCashDriverShare,
        commissionMWK: expectedCashComm,
        driverTipMWK: 0,
        pin: '7788',
        paymentMethod: 'CASH',
        idempotencyKey: `CASH-SETTLE-FIXTURE-${Date.now()}`
      }
    });

    const cashSettlement = await dbLedger.settleRide({
      tripId: cashTripFixture.id,
      paymentMethod: 'CASH',
      driverTipMWK: 0,
      changedBy: driver1User.id,
      idempotencyKey: `CASH-SETTLE-${cashTripFixture.id}`
    });

    const cashCheck = await dbLedger.verifyJournalBalance(cashSettlement.journalId);
    const cashDS = await prisma.driverSettlement.findUnique({ where: { tripId: cashTripFixture.id } });

    const cashSplitRuleHolds =
      cashSettlement.breakdown.commissionMWK === Math.round(cashFare * 0.30) &&
      cashSettlement.breakdown.driverShareMWK === (cashFare - Math.round(cashFare * 0.30)) &&
      cashDS &&
      cashDS.commissionMWK === Math.round(cashFare * 0.30) &&
      cashDS.driverEarningsMWK === (cashFare - Math.round(cashFare * 0.30)) &&
      cashDS.commissionDebtMWK === Math.round(cashFare * 0.30);

    report(
      'Cash ride settlement enforces commission = round(fare * 0.30), driverShare = fare - commission and balances to 0 MWK',
      cashSettlement.netBalanceSum === 0 && cashCheck.isBalanced && cashCheck.sum === 0 && cashSplitRuleHolds,
      `Fare MK ${cashFare} -> Commission: MK ${cashDS?.commissionMWK} (Debt), Driver Share: MK ${cashDS?.driverEarningsMWK}, Journal Net Sum: ${cashCheck.sum} MWK`
    );

    // 5D: Settle Completed Ride with Digital Escrow (Rider Debit + Driver Share + Platform Commission)
    const digitalFare = 2200;
    const expectedDigitalComm = Math.round(digitalFare * 0.30); // 660
    const expectedDigitalDriverShare = digitalFare - expectedDigitalComm; // 1540

    const digitalTripFixture = await prisma.trip.create({
      data: {
        riderId: rider1.id,
        driverId: driver2User.driverProfile.id,
        status: 'IN_TRANSIT',
        tier: 'MOTO',
        pickupAddress: 'Gateway Mall',
        dropoffAddress: 'Area 47',
        pickupLat: -13.9722,
        pickupLng: 33.7667,
        dropoffLat: -13.9650,
        dropoffLng: 33.7820,
        distanceKm: 3.0,
        durationMins: 8,
        fareMWK: digitalFare,
        baseFareMWK: digitalFare,
        bookingFeeMWK: 150,
        driverShareMWK: expectedDigitalDriverShare,
        commissionMWK: expectedDigitalComm,
        driverTipMWK: 0,
        pin: '3344',
        paymentMethod: 'WALLET_ESCROW',
        idempotencyKey: `DIGITAL-SETTLE-FIXTURE-${Date.now()}`
      }
    });

    const digitalSettlement = await dbLedger.settleRide({
      tripId: digitalTripFixture.id,
      paymentMethod: 'WALLET_ESCROW',
      driverTipMWK: 0,
      changedBy: driver2User.id,
      idempotencyKey: `DIGITAL-SETTLE-${digitalTripFixture.id}`
    });

    const digitalCheck = await dbLedger.verifyJournalBalance(digitalSettlement.journalId);
    const digitalDS = await prisma.driverSettlement.findUnique({ where: { tripId: digitalTripFixture.id } });

    const digitalSplitRuleHolds =
      digitalSettlement.breakdown.commissionMWK === Math.round(digitalFare * 0.30) &&
      digitalSettlement.breakdown.driverShareMWK === (digitalFare - Math.round(digitalFare * 0.30)) &&
      digitalDS &&
      digitalDS.commissionMWK === Math.round(digitalFare * 0.30) &&
      digitalDS.driverEarningsMWK === (digitalFare - Math.round(digitalFare * 0.30)) &&
      digitalDS.commissionDebtMWK === 0;

    report(
      'Digital ride settlement enforces commission = round(fare * 0.30), driverShare = fare - commission and balances to 0 MWK',
      digitalSettlement.netBalanceSum === 0 && digitalCheck.isBalanced && digitalCheck.sum === 0 && digitalSplitRuleHolds,
      `Fare MK ${digitalFare} -> Platform Comm: +MK ${digitalDS?.commissionMWK}, Driver Share: +MK ${digitalDS?.driverEarningsMWK}, Rider Debit: -MK ${digitalFare}, Net Sum: ${digitalCheck.sum} MWK`
    );

    // Final clean up of test trip 2
    await prisma.trip.updateMany({
      where: { id: { in: [t2Created.id, cashTripFixture.id, digitalTripFixture.id] } },
      data: { status: 'COMPLETED' }
    });

    console.log('\n=============================================================');
    console.log(`   ALL ${passedTests}/${totalTests} TESTS PASSED (100% SUCCESS)`);
    console.log('   Multi-Tenancy, Driver Race, Partial Index & Ledger Verified');
    console.log('=============================================================\n');
  } finally {
    // Teardown sockets
    for (const s of openSockets) {
      if (s && s.connected) s.disconnect();
    }
    await prisma.$disconnect();
  }
}

runTestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Fatal Test Failure:', err);
    process.exit(1);
  });
