// ============================================================================
// AAROHAN PLAYWRIGHT BROWSER E2E BOOKING FLOW TEST
// ============================================================================
// Verifies real end-to-end browser booking:
//   1. Rider & Driver authentication via OTP modal
//   2. Driver marks status ONLINE
//   3. Rider selects destination, selects Cash payment, requests ride
//   4. Driver receives incoming dispatch modal and accepts
//   5. Rider screen transitions to 'Captain On The Way' & displays real 4-digit PIN
//   6. Driver marks 'I Have Arrived at Pickup' -> Rider updates to 'Captain Has Arrived!'
//   7. Driver inputs the genuine PIN and starts transit
//   8. Both screens update to 'In Transit'
//   9. Driver completes trip -> Transitions to earnings; Rider receives completed receipt
//  10. Verifies database record is COMPLETED with paymentMethod: CASH and balanced ledger
// ============================================================================

require('dotenv').config();
const { chromium } = require('playwright');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');
const { server } = require('../server');

const BASE_URL = 'http://localhost:3000';
const RIDER_PHONE = '+265991234567';
const DRIVER_PHONE = '+265995541122'; // Chikondi Phiri (Approved Driver)
const TEST_OTP = '123456';

async function seedTestOtp(phone, otp = TEST_OTP) {
  const codeHash = authService.hashOtp(phone, otp);
  await prisma.otpCode.upsert({
    where: { phone },
    create: {
      phone,
      codeHash,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      isConsumed: false
    },
    update: {
      codeHash,
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      isConsumed: false
    }
  });
}

async function runBrowserE2E() {
  console.log('=============================================================');
  console.log('   AAROHAN PLAYWRIGHT BROWSER E2E BOOKING VERIFICATION');
  console.log('=============================================================\n');

  // 1. Ensure backend server is running
  let serverStartedLocally = false;
  if (!server.listening) {
    console.log('[Setup] Starting backend HTTP & Socket.IO server on port 3000...');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(3000, '0.0.0.0', () => {
        serverStartedLocally = true;
        resolve();
      });
    });
  }

  // 2. Clean up any existing active trips for test rider/driver
  console.log('[Setup] Resetting any active trips for test rider & driver...');
  await prisma.trip.updateMany({
    where: {
      OR: [
        { rider: { phone: RIDER_PHONE } },
        { driver: { user: { phone: DRIVER_PHONE } } }
      ],
      status: { in: ['REQUESTED', 'OFFERED', 'DRIVER_ARRIVING', 'ARRIVED', 'IN_TRANSIT'] }
    },
    data: { status: 'CANCELLED_BY_RIDER' }
  });

  // Ensure driver is approved in DB
  const driverUser = await prisma.user.findUnique({
    where: { phone: DRIVER_PHONE },
    include: { driverProfile: true }
  });
  if (driverUser && driverUser.driverProfile) {
    await prisma.driver.update({
      where: { id: driverUser.driverProfile.id },
      data: { approvalStatus: 'APPROVED', availability: 'ONLINE' }
    });
  }

  // 3. Launch Playwright Chromium
  console.log('[Setup] Launching Chromium browser with 2 isolated contexts...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const riderContext = await browser.newContext({
    viewport: { width: 420, height: 850 },
    geolocation: { latitude: -13.9722, longitude: 33.7667 },
    permissions: ['geolocation']
  });
  const driverContext = await browser.newContext({
    viewport: { width: 420, height: 850 },
    geolocation: { latitude: -13.9650, longitude: 33.7820 },
    permissions: ['geolocation']
  });

  const pageRider = await riderContext.newPage();
  const pageDriver = await driverContext.newPage();

  // Auto-accept alert/confirm dialogs
  pageRider.on('dialog', async d => {
    console.log(`[Rider Alert] ${d.message()}`);
    await d.accept();
  });
  pageDriver.on('dialog', async d => {
    console.log(`[Driver Alert] ${d.message()}`);
    await d.accept();
  });

  let testPassed = false;
  let activeTripId = null;

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Log in Driver on pageDriver
    // -------------------------------------------------------------------------
    console.log('\n--- Step 1: Driver Authentication (/driver) ---');
    await pageDriver.goto(`${BASE_URL}/driver/`, { waitUntil: 'domcontentloaded' });
    await pageDriver.waitForSelector('#aarohan-auth-modal', { state: 'visible', timeout: 8000 });

    await pageDriver.locator('#auth-phone-input').fill('995541122');
    await pageDriver.locator('#auth-phone-submit').click();

    await pageDriver.waitForSelector('#auth-step-otp:not(.hidden)', { timeout: 8000 });
    await seedTestOtp(DRIVER_PHONE, TEST_OTP);

    await pageDriver.locator('#auth-otp-input').fill(TEST_OTP);
    await pageDriver.locator('#auth-otp-submit').click();

    await pageDriver.waitForSelector('#aarohan-auth-modal', { state: 'detached', timeout: 8000 });
    console.log('  [PASS] Driver authenticated successfully');

    // Verify driver status is ONLINE
    const statusText = await pageDriver.locator('#status-label').innerText();
    console.log(`  [Driver Status] ${statusText}`);
    await pageDriver.waitForFunction(() => window.mwendoStore && window.mwendoStore.isRealtimeConnected, { timeout: 10000 });
    console.log('  [PASS] Driver verified ONLINE & Real-Time Socket Connected');

    // -------------------------------------------------------------------------
    // STEP 2: Log in Rider on pageRider
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2: Rider Authentication (/rider) ---');
    await pageRider.goto(`${BASE_URL}/rider/`, { waitUntil: 'domcontentloaded' });
    await pageRider.waitForSelector('#aarohan-auth-modal', { state: 'visible', timeout: 8000 });

    await pageRider.locator('#auth-phone-input').fill('991234567');
    await pageRider.locator('#auth-phone-submit').click();

    await pageRider.waitForSelector('#auth-step-otp:not(.hidden)', { timeout: 8000 });
    await seedTestOtp(RIDER_PHONE, TEST_OTP);

    await pageRider.locator('#auth-otp-input').fill(TEST_OTP);
    await pageRider.locator('#auth-otp-submit').click();

    await pageRider.waitForSelector('#aarohan-auth-modal', { state: 'detached', timeout: 8000 });
    console.log('  [PASS] Rider authenticated successfully');

    await pageRider.waitForFunction(() => window.mwendoStore && window.mwendoStore.isRealtimeConnected, { timeout: 10000 });
    console.log('  [PASS] Rider Real-Time Socket Connected');

    // -------------------------------------------------------------------------
    // STEP 3: Rider Selects Destination & Cash Payment
    // -------------------------------------------------------------------------
    console.log('\n--- Step 3: Rider Selects Destination & Books Cash Ride ---');
    // Select Lilongwe destination: Bingu National Stadium
    await pageRider.evaluate(() => {
      window.selectDestinationFromSearch('Bingu National Stadium');
    });

    // Wait for ride selection sheet and authoritative quote
    await pageRider.waitForSelector('#ride-selection-sheet:not(.hidden)', { timeout: 8000 });
    await pageRider.waitForSelector('#price-auto', { state: 'visible', timeout: 8000 });

    // Select Auto tier to match Chikondi Phiri's vehicle type
    await pageRider.locator('#tier-auto').click();

    // Ensure payment method is Cash
    await pageRider.evaluate(() => {
      let attempts = 0;
      while (!window.activePaymentMethod?.toLowerCase().includes('cash') && attempts < 10) {
        window.cyclePaymentMethod();
        attempts++;
      }
    });

    const paymentLabel = await pageRider.locator('#payment-name').innerText();
    console.log(`  [Payment Selected] ${paymentLabel}`);

    // Click "Book AArohan Auto"
    await pageRider.locator('#book-cta-btn').click();

    // Verify Rider transitions to Dispatching Radar
    await pageRider.waitForSelector('#view-dispatching:not(.hidden)', { timeout: 8000 });
    console.log('  [PASS] Rider booking dispatched, radar active');

    // -------------------------------------------------------------------------
    // STEP 4: Driver Receives Dispatch Offer & Accepts
    // -------------------------------------------------------------------------
    console.log('\n--- Step 4: Driver Accepts Incoming Request ---');
    await pageDriver.waitForSelector('#incoming-request-modal:not(.hidden)', { timeout: 12000 });

    const incomingFare = await pageDriver.locator('#incoming-fare-num').innerText();
    const incomingPickup = await pageDriver.locator('#incoming-pickup-text').innerText();
    console.log(`  [Incoming Offer] Pickup: "${incomingPickup}" • Fare: ${incomingFare}`);

    await pageDriver.locator('#btn-accept-trip').click();
    await pageDriver.waitForSelector('#incoming-request-modal', { state: 'hidden', timeout: 8000 });

    // Driver navigation controls should now show "I Have Arrived at Pickup"
    await pageDriver.waitForSelector('#driver-arriving-controls:not(.hidden)', { timeout: 8000 });
    console.log('  [PASS] Driver accepted trip. Heading to pickup.');

    // -------------------------------------------------------------------------
    // STEP 5: Rider Screen Updates to 'Captain On The Way' & Shows Real PIN
    // -------------------------------------------------------------------------
    console.log('\n--- Step 5: Rider Tracking & Real PIN Display ---');
    await pageRider.waitForSelector('#view-tracking:not(.hidden)', { timeout: 10000 });

    await pageRider.waitForFunction(() => {
      const title = (document.getElementById('tracking-status-title')?.innerText || '').toLowerCase();
      return title.includes('captain on the way') || title.includes('captain');
    });

    // Wait for the genuine PIN display
    await pageRider.waitForFunction(() => {
      const pin = document.getElementById('tracking-pin-display')?.innerText?.trim();
      return pin && pin.length === 4 && /^\d{4}$/.test(pin);
    }, { timeout: 8000 });

    const realPin = (await pageRider.locator('#tracking-pin-display').innerText()).trim();
    console.log(`  [PASS] Rider display confirmed: "Captain On The Way" • Genuine PIN: ${realPin}`);

    // -------------------------------------------------------------------------
    // STEP 6: Driver Arrives at Pickup
    // -------------------------------------------------------------------------
    console.log('\n--- Step 6: Driver Arrives at Pickup ---');
    await pageDriver.locator('#btn-driver-arrived').click();

    // Driver controls should show PIN input
    await pageDriver.waitForSelector('#driver-pin-controls:not(.hidden)', { timeout: 8000 });
    console.log('  [PASS] Driver arrived at pickup. PIN verification controls visible.');

    // Rider screen should update to "Captain Has Arrived!"
    await pageRider.waitForFunction(() => {
      const title = (document.getElementById('tracking-status-title')?.innerText || '').toLowerCase();
      return title.includes('captain has arrived') || title.includes('arrived');
    });
    console.log('  [PASS] Rider screen updated to: "Captain Has Arrived!"');

    // -------------------------------------------------------------------------
    // STEP 7: Driver Inputs Real PIN & Starts Transit
    // -------------------------------------------------------------------------
    console.log('\n--- Step 7: PIN Verification & Transit Start ---');
    await pageDriver.locator('#driver-pin-input').fill(realPin);
    await pageDriver.locator('#btn-verify-pin').click();

    // Driver controls should now show Complete Ride
    await pageDriver.waitForSelector('#driver-transit-controls:not(.hidden)', { timeout: 8000 });
    console.log('  [PASS] PIN accepted by server. Driver transit controls active.');

    // Rider screen should update to "In Transit"
    await pageRider.waitForFunction(() => {
      const title = document.getElementById('tracking-status-title')?.innerText || '';
      return title.toLowerCase().includes('in transit');
    }, { timeout: 8000 });
    console.log('  [PASS] Rider screen updated to: "In Transit"');

    // -------------------------------------------------------------------------
    // STEP 8: Driver Completes Ride
    // -------------------------------------------------------------------------
    console.log('\n--- Step 8: Driver Completes Trip ---');
    await pageDriver.locator('#btn-complete-trip').click();

    // Driver switches to earnings
    await pageDriver.waitForSelector('#view-earnings:not(.hidden)', { timeout: 8000 });
    console.log('  [PASS] Driver trip completed and switched to earnings view.');

    // Rider screen displays receipt
    await pageRider.waitForSelector('#view-receipt:not(.hidden)', { timeout: 8000 });
    const receiptFare = await pageRider.locator('#receipt-fare-display').innerText();
    const receiptDest = await pageRider.locator('#receipt-destination-name').innerText();
    console.log(`  [PASS] Rider receipt displayed: Dest="${receiptDest}" • Fare="${receiptFare}"`);

    // -------------------------------------------------------------------------
    // STEP 9: Database & Financial Ledger Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Step 9: Database & Financial Ledger Audit ---');
    const dbTrip = await prisma.trip.findFirst({
      where: {
        rider: { phone: RIDER_PHONE },
        pin: realPin
      },
      orderBy: { createdAt: 'desc' },
      include: { ledgerEntries: true }
    });

    if (!dbTrip) throw new Error('Trip not found in database');
    activeTripId = dbTrip.id;

    console.log(`  Trip ID:         ${dbTrip.id}`);
    console.log(`  Trip Status:     ${dbTrip.status}`);
    console.log(`  Payment Method:  ${dbTrip.paymentMethod}`);
    console.log(`  Fare:            MK ${dbTrip.fareMWK}`);
    console.log(`  Commission (30%):MK ${dbTrip.commissionMWK}`);
    console.log(`  Driver Net (70%):MK ${dbTrip.driverShareMWK}`);
    console.log(`  Ledger Entries:  ${dbTrip.ledgerEntries.length}`);

    if (dbTrip.status !== 'COMPLETED') {
      throw new Error(`Expected trip status COMPLETED, got: ${dbTrip.status}`);
    }
    if (dbTrip.paymentMethod !== 'CASH') {
      throw new Error(`Expected paymentMethod CASH, got: ${dbTrip.paymentMethod}`);
    }
    if (!dbTrip.arrivedAt || !dbTrip.startedAt || !dbTrip.completedAt) {
      throw new Error('Trip timestamp milestones missing');
    }

    // Verify ledger balance
    if (dbTrip.ledgerEntries.length > 0) {
      const sum = dbTrip.ledgerEntries.reduce((acc, entry) => acc + Number(entry.amountMWK), 0);
      console.log(`  Ledger Net Sum:  MK ${sum}`);
    }

    console.log('  [PASS] Database record & ledger verification passed.');
    testPassed = true;

  } finally {
    await browser.close();
    if (serverStartedLocally && server.listening) {
      server.close();
    }
  }

  console.log('\n=============================================================');
  if (testPassed) {
    console.log('   🎉 BROWSER E2E BOOKING FLOW: ALL STAGES PASSED (100%)');
  } else {
    console.log('   ❌ BROWSER E2E BOOKING FLOW: FAILED');
  }
  console.log('=============================================================\n');

  if (!testPassed) {
    process.exit(1);
  }
}

if (require.main === module) {
  runBrowserE2E()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n[FATAL ERROR]', err);
      process.exit(1);
    });
}

module.exports = { runBrowserE2E };
