// ============================================================================
// AAROHAN REAL-SERVER & REAL-SOCKET END-TO-END VERIFICATION SUITE
// Lilongwe, Malawi • Authoritative Database & Lifecycle Audit
// ============================================================================
// Verifies via real Socket.IO connections and PostgreSQL:
//   1. Real socket client authentication & connection
//   2. Trip Request -> Driver Acceptance -> Driver Arrival flow
//   3. Wrong PIN rejection (attempts 1..5) & 6th attempt locked enforcement
//   4. Completed Cash Trip:
//      - TripStatusHistory audit trail (REQUESTED -> ARRIVING -> ARRIVED -> TRANSIT -> COMPLETED)
//      - 70/30 Split: commission = round(fare * 0.30), driverShare = fare - commission
//      - DriverSettlement: grossFare, commission, driverEarnings, commissionDebt
//      - LedgerEntry: double-entry rows summing to strictly 0 MWK
//      - Driver accumulated commission debt increment
//   5. Completed Wallet (Digital Escrow) Trip:
//      - TripStatusHistory complete lifecycle
//      - 70/30 Split: commission = round(fare * 0.30), driverShare = fare - commission
//      - DriverSettlement: grossFare, commission, driverEarnings
//      - LedgerEntry: 3-legged journal summing to strictly 0 MWK
//      - Real Wallet balance mutations (Rider debit, Driver credit)
// ============================================================================

const assert = require('assert');
const ioClient = require('socket.io-client');
const prisma = require('../lib/prisma');
const { getTestToken } = require('./auth_helper');
const { app, server } = require('../server');

const BASE_URL = 'http://127.0.0.1:3000';

function connectSocket(userId, role, driverId = null) {
  return new Promise((resolve, reject) => {
    const token = getTestToken({ userId, role, driverId });
    const socket = ioClient(BASE_URL, {
      transports: ['websocket'],
      auth: { token }
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket connection timeout for user ${userId}`));
    }, 10000);

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

async function runE2ETestSuite() {
  console.log('=============================================================');
  console.log('   AAROHAN END-TO-END REAL SOCKETS & SERVER VERIFICATION');
  console.log('   Lilongwe, Malawi • Full Database Lifecycle Audit');
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

  // Ensure real server is listening
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

  const openSockets = [];

  try {
    // -------------------------------------------------------------------------
    // SETUP: Discover Rider and Driver Fixtures
    // -------------------------------------------------------------------------
    console.log('--- Phase 0: Test Fixture Discovery & State Reset ---');

    const riderUser = await prisma.user.findUnique({
      where: { phone: '+265991234567' },
      include: { wallet: true }
    });
    assert.ok(riderUser, 'Demo rider (+265991234567 Chisomo) must exist in DB');

    const driverUser = await prisma.user.findUnique({
      where: { phone: '+265995541122' },
      include: { driverProfile: true, wallet: true }
    });
    assert.ok(driverUser && driverUser.driverProfile, 'Demo driver 1 (+265995541122 Chikondi) must exist in DB');

    // Clean up any lingering active trips for rider/driver
    await prisma.trip.updateMany({
      where: {
        OR: [
          { riderId: riderUser.id },
          { driverId: driverUser.driverProfile.id }
        ],
        status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
      },
      data: { status: 'COMPLETED' }
    });

    console.log(`   Rider: ${riderUser.name} (${riderUser.id})`);
    console.log(`   Driver: ${driverUser.name} (${driverUser.driverProfile.id})\n`);

    // Connect real Socket.IO clients
    const riderSocket = await connectSocket(riderUser.id, 'RIDER');
    const driverSocket = await connectSocket(driverUser.id, 'DRIVER', driverUser.driverProfile.id);
    openSockets.push(riderSocket, driverSocket);

    // -------------------------------------------------------------------------
    // SCENARIO 1: WRONG PIN REJECTION & 6TH ATTEMPT LOCKED
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO 1: Wrong PIN Rejection & 6th Attempt Lock ---');

    // 1A. Request a trip
    const pinTestTrip = await new Promise((resolve, reject) => {
      riderSocket.emit('trip:request', {
        pickup: { name: 'Area 10', lat: -13.9600, lng: 33.7800 },
        destination: { name: 'Gateway Mall', lat: -13.9722, lng: 33.7667 },
        tierId: 'cab',
        fare: 4000,
        baseFare: 4000,
        distanceKm: 4.5,
        durationMins: 12,
        paymentMethod: 'CASH',
        idempotencyKey: `E2E-PIN-TEST-${Date.now()}`
      }, (res) => {
        if (res && res.success) resolve(res.trip);
        else reject(new Error(res?.error || 'Failed to request pin test trip'));
      });
    });

    report(
      'Rider socket creates trip booking with unique safety PIN',
      pinTestTrip && pinTestTrip.id && pinTestTrip.pin,
      `Trip ID: ${pinTestTrip.id} • Generated PIN: ${pinTestTrip.pin}`
    );

    // 1B. Driver accepts trip
    const pinAccept = await new Promise((resolve) => {
      driverSocket.emit('trip:accept', {
        tripId: pinTestTrip.id,
        driverId: driverUser.driverProfile.id
      }, resolve);
    });
    report(
      'Driver socket accepts trip',
      pinAccept.success && pinAccept.trip.status === 'DRIVER_ARRIVING',
      `Driver: ${pinAccept.trip?.driverId} • Status: ${pinAccept.trip?.status}`
    );

    // 1C. Driver arrives at pickup
    const pinArrive = await new Promise((resolve) => {
      driverSocket.emit('trip:arrived', { tripId: pinTestTrip.id }, resolve);
    });
    report(
      'Driver socket signals arrival at pickup location',
      pinArrive.success && pinArrive.trip.status === 'ARRIVED',
      `Status: ${pinArrive.trip?.status}`
    );

    // 1D. Enter wrong PIN 5 times: verify rejected with 'Invalid passenger safety PIN'
    const wrongPin = '0000';
    assert.notStrictEqual(wrongPin, pinTestTrip.pin, 'Wrong PIN must not match real PIN');

    for (let attempt = 1; attempt <= 5; attempt++) {
      const pinResult = await new Promise((resolve) => {
        driverSocket.emit('trip:start_transit', {
          tripId: pinTestTrip.id,
          pin: wrongPin
        }, resolve);
      });

      const dbTripAttempt = await prisma.trip.findUnique({ where: { id: pinTestTrip.id } });
      report(
        `Wrong PIN attempt ${attempt} is rejected with "Invalid passenger safety PIN"`,
        !pinResult.success &&
        pinResult.error === 'Invalid passenger safety PIN' &&
        dbTripAttempt.pinAttempts === attempt,
        `Attempt ${attempt}/5 recorded in DB: pinAttempts = ${dbTripAttempt.pinAttempts}`
      );
    }

    // 1E. 6th Attempt: Must be locked and rejected
    const sixthResult = await new Promise((resolve) => {
      driverSocket.emit('trip:start_transit', {
        tripId: pinTestTrip.id,
        pin: wrongPin
      }, resolve);
    });

    const dbTripLocked = await prisma.trip.findUnique({ where: { id: pinTestTrip.id } });
    report(
      '6th PIN attempt is strictly locked with "PIN entry locked: Maximum attempts (5) exceeded"',
      !sixthResult.success &&
      sixthResult.error === 'PIN entry locked: Maximum attempts (5) exceeded' &&
      dbTripLocked.pinAttempts >= 5,
      `Driver lock enforced in real-time • Error: "${sixthResult.error}"`
    );

    // Free rider active slot from locked test trip
    await prisma.trip.update({
      where: { id: pinTestTrip.id },
      data: { status: 'CANCELLED_BY_RIDER', cancelledBy: 'RIDER', cancelReason: 'PIN locked test complete' }
    });

    // -------------------------------------------------------------------------
    // SCENARIO 2: COMPLETE CASH TRIP LIFECYCLE & SETTLEMENT AUDIT
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 2: Complete Cash Trip Lifecycle & Financial Audit ---');

    const initialDriverProfile = await prisma.driver.findUnique({
      where: { id: driverUser.driverProfile.id }
    });
    const initialDebtMWK = initialDriverProfile.commissionDebtMWK;

    // 2A. Request Cash Trip
    const cashTrip = await new Promise((resolve, reject) => {
      riderSocket.emit('trip:request', {
        pickup: { name: 'Capital Hill City Center', lat: -13.9500, lng: 33.7900 },
        destination: { name: 'Old Town Lilongwe', lat: -13.9850, lng: 33.7700 },
        tierId: 'cab',
        fare: 5000,
        baseFare: 5000,
        distanceKm: 5.8,
        durationMins: 15,
        paymentMethod: 'CASH',
        idempotencyKey: `E2E-CASH-TRIP-${Date.now()}`
      }, (res) => {
        if (res && res.success) resolve(res.trip);
        else reject(new Error(res?.error || 'Failed to request cash trip'));
      });
    });

    const cashFareMWK = cashTrip.fareMWK;
    const expectedCashComm = Math.round(cashFareMWK * 0.30);
    const expectedCashDriverShare = cashFareMWK - expectedCashComm;

    // 2B. Accept Cash Trip
    await new Promise((resolve) => {
      driverSocket.emit('trip:accept', {
        tripId: cashTrip.id,
        driverId: driverUser.driverProfile.id
      }, resolve);
    });

    // 2C. Arrive
    await new Promise((resolve) => {
      driverSocket.emit('trip:arrived', { tripId: cashTrip.id }, resolve);
    });

    // 2D. Start Transit with Correct PIN
    const cashTransit = await new Promise((resolve) => {
      driverSocket.emit('trip:start_transit', {
        tripId: cashTrip.id,
        pin: cashTrip.pin
      }, resolve);
    });

    report(
      'Correct passenger safety PIN starts transit on cash trip',
      cashTransit.success && cashTransit.trip.status === 'IN_TRANSIT',
      `Trip status: ${cashTransit.trip?.status}`
    );

    // 2E. Complete Cash Ride
    const cashComplete = await new Promise((resolve) => {
      driverSocket.emit('trip:complete', {
        tripId: cashTrip.id,
        paymentMethod: 'CASH',
        driverTip: 0
      }, resolve);
    });

    report(
      'Driver socket completes cash trip via real socket event',
      cashComplete.success && cashComplete.trip.status === 'COMPLETED',
      `Trip ID: ${cashComplete.trip?.id} • Journal: ${cashComplete.journalId}`
    );

    // 2F. Read Database & Assert Lifecycle, 70/30 Split, DriverSettlement, LedgerEntry
    const cashStatusHistory = await prisma.tripStatusHistory.findMany({
      where: { tripId: cashTrip.id },
      orderBy: { createdAt: 'asc' }
    });
    const cashStatuses = cashStatusHistory.map(h => h.status);

    report(
      'TripStatusHistory records exact immutable lifecycle audit trail for cash trip',
      JSON.stringify(cashStatuses) === JSON.stringify(['REQUESTED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT', 'COMPLETED']),
      `Audit Trail: ${cashStatuses.join(' -> ')}`
    );

    const cashSettlementRecord = await prisma.driverSettlement.findUnique({
      where: { tripId: cashTrip.id }
    });

    const cashSplitRuleHolds =
      cashSettlementRecord &&
      cashSettlementRecord.grossFareMWK === cashFareMWK &&
      cashSettlementRecord.commissionMWK === expectedCashComm &&
      cashSettlementRecord.driverEarningsMWK === expectedCashDriverShare &&
      cashSettlementRecord.commissionDebtMWK === expectedCashComm &&
      cashSettlementRecord.settlementStatus === 'PENDING_CASH_COLLECTION';

    report(
      'DriverSettlement adheres strictly to commission = round(fare * 0.30) and driverShare = fare - commission',
      cashSplitRuleHolds,
      `Gross: MK ${cashSettlementRecord?.grossFareMWK} • 30% Comm: MK ${cashSettlementRecord?.commissionMWK} • Driver Share: MK ${cashSettlementRecord?.driverEarningsMWK} • Debt: MK ${cashSettlementRecord?.commissionDebtMWK}`
    );

    const cashLedgerEntries = await prisma.ledgerEntry.findMany({
      where: { journalId: cashComplete.journalId }
    });
    const cashJournalSum = cashLedgerEntries.reduce((acc, row) => acc + row.amountMWK, 0);

    report(
      'Cash ride journal rows sum to exactly 0 MWK (Driver Debt -1500, Platform Rev +1500)',
      cashJournalSum === 0 && cashLedgerEntries.length === 2,
      `Journal ${cashComplete.journalId} (${cashLedgerEntries.length} legs) • Net Sum: ${cashJournalSum} MWK`
    );

    const updatedDriverProfile = await prisma.driver.findUnique({
      where: { id: driverUser.driverProfile.id }
    });

    report(
      'Driver accumulated cash commission debt increased by exactly 30% (1,500 MWK)',
      updatedDriverProfile.commissionDebtMWK === initialDebtMWK + expectedCashComm,
      `Debt Before: MK ${initialDebtMWK} • Debt After: MK ${updatedDriverProfile.commissionDebtMWK} (Δ +MK ${expectedCashComm})`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 3: COMPLETE WALLET (DIGITAL ESCROW) TRIP LIFECYCLE
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 3: Complete Wallet Trip Lifecycle & Wallet Balance Audit ---');

    // Fetch initial wallet balances
    const initialRiderWallet = await prisma.wallet.findUnique({ where: { userId: riderUser.id } });
    const initialDriverWallet = await prisma.wallet.findUnique({ where: { userId: driverUser.id } });

    // 3A. Request Digital Trip
    const digitalTrip = await new Promise((resolve, reject) => {
      riderSocket.emit('trip:request', {
        pickup: { name: 'Gateway Mall', lat: -13.9722, lng: 33.7667 },
        destination: { name: 'Area 47 Sector 3', lat: -13.9650, lng: 33.7820 },
        tierId: 'moto',
        fare: 3500,
        baseFare: 3500,
        distanceKm: 3.2,
        durationMins: 9,
        paymentMethod: 'WALLET_ESCROW',
        idempotencyKey: `E2E-DIGITAL-TRIP-${Date.now()}`
      }, (res) => {
        if (res && res.success) resolve(res.trip);
        else reject(new Error(res?.error || 'Failed to request digital trip'));
      });
    });

    const digitalFareMWK = digitalTrip.fareMWK;
    const expectedDigitalComm = Math.round(digitalFareMWK * 0.30);
    const expectedDigitalDriverShare = digitalFareMWK - expectedDigitalComm;

    // 3B. Driver Accepts
    await new Promise((resolve) => {
      driverSocket.emit('trip:accept', {
        tripId: digitalTrip.id,
        driverId: driverUser.driverProfile.id
      }, resolve);
    });

    // 3C. Driver Arrives
    await new Promise((resolve) => {
      driverSocket.emit('trip:arrived', { tripId: digitalTrip.id }, resolve);
    });

    // 3D. Start Transit with Correct PIN
    const digitalTransit = await new Promise((resolve) => {
      driverSocket.emit('trip:start_transit', {
        tripId: digitalTrip.id,
        pin: digitalTrip.pin
      }, resolve);
    });

    report(
      'Correct passenger PIN starts transit on digital trip',
      digitalTransit.success && digitalTransit.trip.status === 'IN_TRANSIT',
      `Trip status: ${digitalTransit.trip?.status}`
    );

    // 3E. Complete Digital Ride
    const digitalComplete = await new Promise((resolve) => {
      driverSocket.emit('trip:complete', {
        tripId: digitalTrip.id,
        paymentMethod: 'WALLET_ESCROW',
        driverTip: 0
      }, resolve);
    });

    report(
      'Driver socket completes digital trip via real socket event',
      digitalComplete.success && digitalComplete.trip.status === 'COMPLETED',
      `Trip ID: ${digitalComplete.trip?.id} • Journal: ${digitalComplete.journalId}`
    );

    // 3F. Read Database: Status History, 70/30 Split, DriverSettlement, LedgerEntry, Wallets
    const digitalStatusHistory = await prisma.tripStatusHistory.findMany({
      where: { tripId: digitalTrip.id },
      orderBy: { createdAt: 'asc' }
    });
    const digitalStatuses = digitalStatusHistory.map(h => h.status);

    report(
      'TripStatusHistory records exact immutable lifecycle audit trail for digital trip',
      JSON.stringify(digitalStatuses) === JSON.stringify(['REQUESTED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT', 'COMPLETED']),
      `Audit Trail: ${digitalStatuses.join(' -> ')}`
    );

    const digitalSettlementRecord = await prisma.driverSettlement.findUnique({
      where: { tripId: digitalTrip.id }
    });

    const digitalSplitRuleHolds =
      digitalSettlementRecord &&
      digitalSettlementRecord.grossFareMWK === digitalFareMWK &&
      digitalSettlementRecord.commissionMWK === expectedDigitalComm &&
      digitalSettlementRecord.driverEarningsMWK === expectedDigitalDriverShare &&
      digitalSettlementRecord.commissionDebtMWK === 0 &&
      digitalSettlementRecord.settlementStatus === 'SETTLED';

    report(
      'Digital DriverSettlement enforces commission = round(fare * 0.30) and driverShare = fare - commission',
      digitalSplitRuleHolds,
      `Gross: MK ${digitalSettlementRecord?.grossFareMWK} • 30% Comm: MK ${digitalSettlementRecord?.commissionMWK} • Driver Share: MK ${digitalSettlementRecord?.driverEarningsMWK} • Status: ${digitalSettlementRecord?.settlementStatus}`
    );

    const digitalLedgerEntries = await prisma.ledgerEntry.findMany({
      where: { journalId: digitalComplete.journalId }
    });
    const digitalJournalSum = digitalLedgerEntries.reduce((acc, row) => acc + row.amountMWK, 0);

    report(
      'Digital ride journal rows sum to exactly 0 MWK (Rider -3500, Driver +2450, Platform +1050)',
      digitalJournalSum === 0 && digitalLedgerEntries.length === 3,
      `Journal ${digitalComplete.journalId} (${digitalLedgerEntries.length} legs) • Net Sum: ${digitalJournalSum} MWK`
    );

    // Verify Real Wallet Balance Mutations
    const finalRiderWallet = await prisma.wallet.findUnique({ where: { userId: riderUser.id } });
    const finalDriverWallet = await prisma.wallet.findUnique({ where: { userId: driverUser.id } });

    const riderBalanceChange = finalRiderWallet.balanceMWK - initialRiderWallet.balanceMWK;
    const driverBalanceChange = finalDriverWallet.balanceMWK - initialDriverWallet.balanceMWK;

    report(
      'Rider wallet balance is debited exactly the gross fare (-3,500 MWK)',
      riderBalanceChange === -digitalFareMWK,
      `Rider Balance: ${initialRiderWallet.balanceMWK} -> ${finalRiderWallet.balanceMWK} MWK (Δ ${riderBalanceChange} MWK)`
    );

    report(
      'Driver wallet balance is credited exactly the 70% driver share (+2,450 MWK)',
      driverBalanceChange === expectedDigitalDriverShare,
      `Driver Balance: ${initialDriverWallet.balanceMWK} -> ${finalDriverWallet.balanceMWK} MWK (Δ +${driverBalanceChange} MWK)`
    );

    console.log('\n=============================================================');
    console.log(`   ALL ${passedTests}/${totalTests} E2E TESTS PASSED (100% SUCCESS)`);
    console.log('   Real Sockets, Real Server, PIN Lock, 70/30 Split & DB Verified');
    console.log('=============================================================\n');
  } finally {
    // Teardown sockets
    for (const s of openSockets) {
      if (s && s.connected) s.disconnect();
    }
    await prisma.$disconnect();
  }
}

runE2ETestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Fatal E2E Test Failure:', err);
    process.exit(1);
  });
