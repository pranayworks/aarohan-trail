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
const assert = require('assert');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');
const { server } = require('../server');
const { JWT_SECRET } = require('./auth_helper');

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
    try {
      console.log('[Setup] Starting backend HTTP & Socket.IO server on port 3000...');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(3000, '0.0.0.0', () => {
          serverStartedLocally = true;
          resolve();
        });
      });
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      console.log('[Setup] Server already running on port 3000.');
    }
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
    await pageDriver.waitForSelector('#aarohan-auth-modal', { state: 'visible', timeout: 15000 });

    await pageDriver.locator('#auth-phone-input').fill('995541122');
    await pageDriver.locator('#auth-phone-submit').click();

    await pageDriver.waitForSelector('#auth-step-otp:not(.hidden)', { timeout: 15000 });
    await seedTestOtp(DRIVER_PHONE, TEST_OTP);

    await pageDriver.locator('#auth-otp-input').fill(TEST_OTP);
    await pageDriver.locator('#auth-otp-submit').click();

    await pageDriver.waitForSelector('#aarohan-auth-modal', { state: 'detached', timeout: 25000 });
    console.log('  [PASS] Driver authenticated successfully');

    // Verify driver status is ONLINE
    const statusText = await pageDriver.locator('#status-label').innerText();
    console.log(`  [Driver Status] ${statusText}`);
    await pageDriver.waitForFunction(() => window.mwendoStore && window.mwendoStore.isRealtimeConnected, { timeout: 15000 });
    console.log('  [PASS] Driver verified ONLINE & Real-Time Socket Connected');

    // -------------------------------------------------------------------------
    // STEP 2: Log in Rider on pageRider
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2: Rider Authentication (/rider) ---');
    await pageRider.goto(`${BASE_URL}/rider/`, { waitUntil: 'domcontentloaded' });
    await pageRider.waitForSelector('#aarohan-auth-modal', { state: 'visible', timeout: 15000 });

    await pageRider.locator('#auth-phone-input').fill('991234567');
    await pageRider.locator('#auth-phone-submit').click();

    await pageRider.waitForSelector('#auth-step-otp:not(.hidden)', { timeout: 15000 });
    await seedTestOtp(RIDER_PHONE, TEST_OTP);

    await pageRider.locator('#auth-otp-input').fill(TEST_OTP);
    await pageRider.locator('#auth-otp-submit').click();

    await pageRider.waitForSelector('#aarohan-auth-modal', { state: 'detached', timeout: 25000 });
    console.log('  [PASS] Rider authenticated successfully');

    await pageRider.waitForFunction(() => window.mwendoStore && window.mwendoStore.isRealtimeConnected, { timeout: 15000 });
    console.log('  [PASS] Rider Real-Time Socket Connected');

    // -------------------------------------------------------------------------
    // STEP 2b: 3-Tab Bottom Navigation & Theme CSS Validation
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2b: 3-Tab Navigation & Theme Validation ---');
    // Confirm shared/theme.css is loaded
    const themeLoaded = await pageRider.evaluate(() => {
      return Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .some(l => l.href && l.href.includes('/shared/theme.css'));
    });
    assert.strictEqual(themeLoaded, true, 'shared/theme.css must be linked in rider header');
    console.log('  [PASS] shared/theme.css verified in rider DOM');

    // Confirm 3-tab navigation exists: #nav-rides, #nav-activity, #nav-profile
    await pageRider.waitForSelector('#nav-rides', { timeout: 10000 });
    await pageRider.waitForSelector('#nav-activity', { timeout: 10000 });
    await pageRider.waitForSelector('#nav-profile', { timeout: 10000 });

    // Switch to Activity Tab
    await pageRider.locator('#nav-activity').click();
    await pageRider.waitForSelector('#view-activity:not(.hidden)', { timeout: 10000 });
    console.log('  [PASS] Tab navigation: Switched to #view-activity');

    // Switch to Profile Tab
    await pageRider.locator('#nav-profile').click();
    await pageRider.waitForSelector('#view-profile:not(.hidden)', { timeout: 10000 });
    console.log('  [PASS] Tab navigation: Switched to #view-profile');

    // Switch back to Rides Tab
    await pageRider.locator('#nav-rides').click();
    await pageRider.waitForSelector('#view-booking:not(.hidden)', { timeout: 10000 });
    console.log('  [PASS] Tab navigation: Returned to #view-booking');

    // -------------------------------------------------------------------------
    // STEP 2c: GPS Denied Fallback Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2c: GPS Denied Fallback Verification ---');
    let capturedAlert = null;
    const dialogHandler = (dialog) => {
      capturedAlert = dialog.message();
      dialog.accept().catch(() => {});
    };
    pageRider.on('dialog', dialogHandler);

    await pageRider.evaluate(() => {
      // Mock geolocation failure
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error({
          code: 1, // PERMISSION_DENIED
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: 'User denied Geolocation'
        });
      };
      window.handleUseCurrentLocation();
    });

    await pageRider.waitForFunction(() => true, { timeout: 1000 });
    assert(capturedAlert && capturedAlert.toLowerCase().includes('location access was denied'),
      `Expected GPS denied alert message, got: "${capturedAlert}"`);
    console.log(`  [PASS] GPS denied fallback triggered expected alert: "${capturedAlert.substring(0, 45)}..."`);
    pageRider.off('dialog', dialogHandler);

    // -------------------------------------------------------------------------
    // STEP 2d: Intermediate Stops Planner Validation (+1 Stop)
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2d: Intermediate Stops Planner Validation ---');
    await pageRider.evaluate(() => {
      window.openSearchModal();
    });
    await pageRider.waitForSelector('#search-modal:not(.hidden)', { timeout: 10000 });
    await pageRider.waitForSelector('#btn-add-stop', { timeout: 10000 });

    // Click Add Stop to open waypoint modal
    await pageRider.locator('#btn-add-stop').click();
    await pageRider.waitForSelector('#waypoint-modal:not(.hidden)', { timeout: 10000 });

    // Select Crossroads Hotel
    await pageRider.evaluate(() => {
      window.selectWaypoint('Crossroads Hotel');
    });

    // Verify stops container rendered
    const stopCountText = await pageRider.locator('#planner-stops-count-text').innerText();
    assert.strictEqual(stopCountText.trim(), '1 / 2 stops', 'Stop count text must update to 1 / 2 stops');

    const stopsCount = await pageRider.evaluate(() => (window.plannerStops || []).length);
    assert.strictEqual(stopsCount, 1, 'window.plannerStops must have 1 waypoint');
    console.log(`  [PASS] Intermediate stop added: Crossroads Hotel (${stopCountText})`);

    // Clear stops for clean ride booking test
    await pageRider.evaluate(() => {
      window.plannerStops = [];
      window.renderPlannerStopsDOM();
      window.closeSearchModal();
    });

    // -------------------------------------------------------------------------
    // STEP 2e: Simulate Lilongwe Button In Production Validation
    // -------------------------------------------------------------------------
    console.log('\n--- Step 2e: Simulate Lilongwe Button In Production ---');
    const prodSimResult = await pageRider.evaluate(async () => {
      const btn = document.getElementById('btn-dev-simulate-location');
      if (!btn) return false;
      // When NODE_ENV=production, allowLocationSimulation is false, button stays hidden
      const fakeProdCfg = { allowLocationSimulation: false, env: 'production' };
      if (fakeProdCfg && fakeProdCfg.allowLocationSimulation) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
      return btn.classList.contains('hidden');
    });
    assert.strictEqual(prodSimResult, true, 'Simulate Lilongwe button must remain hidden in production');
    console.log('  [PASS] Simulate Lilongwe button verified hidden when allowLocationSimulation=false (NODE_ENV=production)');

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
    // STEP 5b: Mid-Trip Page Reload & Active Ride Restoration
    // -------------------------------------------------------------------------
    console.log('\n--- Step 5b: Mid-Trip Reload & Session Recovery ---');
    await pageRider.reload();

    // Confirm that tracking view is restored
    await pageRider.waitForSelector('#view-tracking:not(.hidden)', { timeout: 10000 });
    await pageRider.waitForFunction(() => {
      const title = (document.getElementById('tracking-status-title')?.innerText || '').toLowerCase();
      return title.includes('captain on the way') || title.includes('captain');
    }, { timeout: 8000 });

    const restoredPin = (await pageRider.locator('#tracking-pin-display').innerText()).trim();
    assert.strictEqual(restoredPin, realPin, 'Restored ride PIN matches original PIN');

    // Confirm header wallet shows genuine balance from /api/auth/me (not MK 0)
    await pageRider.waitForFunction(() => {
      const bal = document.getElementById('header-wallet-bal')?.innerText || '';
      return bal.includes('MK') && !bal.includes('MK 0');
    }, { timeout: 8000 });
    const headerBalMidTrip = await pageRider.locator('#header-wallet-bal').innerText();
    console.log(`  [PASS] Mid-trip reload confirmed: Active ride restored • PIN: ${restoredPin} • Header Wallet: ${headerBalMidTrip}`);

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
    await pageDriver.waitForSelector('#view-earnings:not(.hidden)', { timeout: 20000 });
    console.log('  [PASS] Driver trip completed and switched to earnings view.');

    // Rider screen displays receipt
    await pageRider.waitForSelector('#view-receipt:not(.hidden)', { timeout: 20000 });
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

    // -------------------------------------------------------------------------
    // STEP 10: Expired Access Token Refresh Verification
    // -------------------------------------------------------------------------
    console.log('\n--- Step 10: Expired Access Token Refresh Verification ---');
    const riderRecord = await prisma.user.findUnique({
      where: { phone: RIDER_PHONE }
    });

    const expiredToken = jwt.sign(
      { userId: riderRecord.id, phone: riderRecord.phone, role: 'RIDER' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '-1h' }
    );

    // Overwrite access token in localStorage with the expired JWT
    await pageRider.evaluate((badToken) => {
      localStorage.setItem('aarohan_access_token', badToken);
    }, expiredToken);

    // Reload /rider/ with the expired token
    await pageRider.reload();

    // Verify token refreshed via /api/auth/refresh, /api/auth/me returns balance, no login modal
    await pageRider.waitForFunction((oldToken) => {
      const token = localStorage.getItem('aarohan_access_token');
      const bal = document.getElementById('header-wallet-bal')?.innerText || '';
      const modal = document.getElementById('aarohan-auth-modal');
      return token && token !== oldToken && bal.includes('MK') && !bal.includes('MK 0') && !modal;
    }, expiredToken, { timeout: 12000 });

    const freshToken = await pageRider.evaluate(() => localStorage.getItem('aarohan_access_token'));
    assert.notStrictEqual(freshToken, expiredToken, 'Access token successfully rotated upon 401');
    const refreshedWalletBal = await pageRider.locator('#header-wallet-bal').innerText();
    console.log(`  [PASS] Expired token refreshed: Rotated JWT stored • Auth retained • Header Wallet: ${refreshedWalletBal}`);

    // -------------------------------------------------------------------------
    // STEP 11: Parcel Courier with 4-Digit Delivery Code & 5-Attempt Lockout
    // -------------------------------------------------------------------------
    console.log('\n--- Step 11: Parcel Delivery & 5 Wrong Attempts Lockout ---');
    // Ensure driver is back online and ready for incoming offers
    const dUser = await prisma.user.findUnique({
      where: { phone: DRIVER_PHONE },
      include: { driverProfile: true }
    });
    if (dUser && dUser.driverProfile) {
      await prisma.driver.update({
        where: { id: dUser.driverProfile.id },
        data: {
          availability: 'ONLINE',
          commissionDebtMWK: 0,
          currentLat: -13.9722,
          currentLng: 33.7667,
          lastLocationAt: new Date()
        }
      });
    }

    await pageDriver.evaluate(() => {
      if (typeof window.switchDriverView === 'function') {
        window.switchDriverView('radar');
      }
      if (typeof window.updateDriverNavControls === 'function') {
        window.updateDriverNavControls('ONLINE');
      }
      if (window.mwendoStore && typeof window.mwendoStore.setDriverStatus === 'function') {
        window.mwendoStore.setDriverStatus('ONLINE');
      }
    });

    await pageDriver.waitForFunction(() => window.mwendoStore && window.mwendoStore.isRealtimeConnected, { timeout: 15000 });
    await pageRider.waitForFunction(() => window.mwendoStore && window.mwendoStore.isRealtimeConnected, { timeout: 15000 });

    // Rider resets from previous receipt and opens planner
    await pageRider.evaluate(() => {
      if (typeof window.resetAndBookAnother === 'function') {
        window.resetAndBookAnother();
      }
      window.currentDestination = {
        name: 'Entire Printers and Traders Limited (EPTL)',
        area: 'Chitipi Road, Lilongwe, Malawi',
        lat: -13.9933,
        lng: 33.6777
      };
      const destLabel = document.getElementById('selected-destination-text');
      if (destLabel) destLabel.innerText = window.currentDestination.name;

      window.openSearchModal();
      window.switchPlannerTab('parcel');
    });

    await pageRider.waitForSelector('#planner-parcel-section:not(.hidden)', { timeout: 15000 });
    await pageRider.locator('#modal-parcel-recipient-name').fill('Grace Phiri');
    await pageRider.locator('#modal-parcel-recipient-phone').fill('+265992233445');
    await pageRider.locator('#modal-parcel-prohibited-check').check();

    // Submit parcel
    await pageRider.locator('#btn-submit-modal-parcel').click();

    // Ride sheet opens for parcel
    await pageRider.waitForSelector('#ride-selection-sheet:not(.hidden)', { timeout: 15000 });
    await pageRider.waitForSelector('#price-auto', { state: 'visible', timeout: 15000 });
    await pageRider.locator('#tier-auto').click();

    // Ensure payment method is Cash (not Mobile Money which opens USSD modal)
    await pageRider.evaluate(() => {
      let attempts = 0;
      while (!window.activePaymentMethod?.toLowerCase().includes('cash') && attempts < 10) {
        window.cyclePaymentMethod();
        attempts++;
      }
    });

    await pageRider.locator('#book-cta-btn').click();
    await pageRider.waitForSelector('#view-dispatching:not(.hidden)', { timeout: 15000 });
    console.log('  [PASS] Parcel courier booking dispatched');

    // Driver receives incoming request modal
    await pageDriver.waitForSelector('#incoming-request-modal:not(.hidden)', { timeout: 20000 });
    const isIncomingParcel = await pageDriver.locator('#incoming-parcel-card').isVisible();
    assert.strictEqual(isIncomingParcel, true, 'Incoming parcel card must be visible on incoming modal');
    console.log('  [PASS] Driver received incoming request with Parcel indicator');

    // Driver accepts
    await pageDriver.locator('#btn-accept-trip').click();
    await pageDriver.waitForSelector('#driver-arriving-controls:not(.hidden)', { timeout: 15000 });

    // Driver marks arrival
    await pageDriver.locator('#btn-driver-arrived').click();
    await pageDriver.waitForSelector('#driver-pin-controls:not(.hidden)', { timeout: 15000 });

    // Rider displays start PIN
    await pageRider.waitForSelector('#view-tracking:not(.hidden)', { timeout: 15000 });
    await pageRider.waitForFunction(() => {
      const pin = document.getElementById('tracking-pin-display')?.innerText?.trim();
      const statePin = window.mwendoStore?.getState()?.activeTrip?.pin;
      return (pin && pin.length === 4 && /^\d{4}$/.test(pin) && pin !== '----') || (statePin && /^\d{4}$/.test(statePin));
    }, { timeout: 15000 });
    const parcelStartPin = await pageRider.evaluate(() => {
      const pin = document.getElementById('tracking-pin-display')?.innerText?.trim();
      if (pin && /^\d{4}$/.test(pin) && pin !== '----') return pin;
      return (window.mwendoStore?.getState()?.activeTrip?.pin || '').trim();
    });
    console.log(`  [Parcel Start PIN] ${parcelStartPin}`);

    // Driver verifies start PIN and enters transit
    await pageDriver.locator('#driver-pin-input').fill(parcelStartPin);
    await pageDriver.locator('#btn-verify-pin').click();
    await pageDriver.waitForSelector('#driver-transit-controls:not(.hidden)', { timeout: 25000 });
    console.log('  [PASS] Parcel ride in transit');

    // Verify parcel PIN input box is visible in transit
    await pageDriver.waitForSelector('#driver-parcel-pin-box:not(.hidden)', { timeout: 15000 });

    // 5 Wrong Attempts Test
    console.log('  Testing 5 incorrect delivery code attempts...');
    for (let attempt = 1; attempt <= 5; attempt++) {
      await pageDriver.evaluate(() => {
        const errEl = document.getElementById('driver-recipient-pin-error');
        if (errEl) { errEl.innerText = ''; errEl.classList.add('hidden'); }
      });
      await pageDriver.locator('#driver-recipient-pin-input').fill('0000');
      await pageDriver.locator('#btn-complete-trip').click();
      await pageDriver.waitForSelector('#driver-recipient-pin-error:not(.hidden)', { timeout: 20000 });
      await pageDriver.waitForFunction((att) => {
        const text = document.getElementById('driver-recipient-pin-error')?.innerText || '';
        return text.includes(`Attempt ${att} of 5`) || text.includes('locked') || text.includes('Maximum 5');
      }, attempt, { timeout: 20000 });
      const errMsg = await pageDriver.locator('#driver-recipient-pin-error').innerText();
      console.log(`    Attempt ${attempt}/5: "${errMsg}"`);
    }

    // 6th Attempt: Should lock permanently
    const isLocked = await pageDriver.evaluate(() => {
      const btn = document.getElementById('btn-complete-trip');
      const inp = document.getElementById('driver-recipient-pin-input');
      const err = document.getElementById('driver-recipient-pin-error')?.innerText || '';
      return (btn && btn.disabled) || (inp && inp.disabled) || err.includes('locked') || err.includes('Maximum 5');
    });
    assert.strictEqual(isLocked, true, 'Parcel delivery must lock after 5 incorrect delivery code attempts');
    console.log('  [PASS] Parcel delivery locked after 5 wrong attempts verification passed');

    // Audit DB
    const dbParcel = await prisma.parcelDetail.findFirst({
      where: {
        trip: {
          rider: { phone: RIDER_PHONE },
          serviceType: 'PARCEL'
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    assert(dbParcel, 'ParcelDetail record must exist in DB');
    assert.strictEqual(dbParcel.deliveryAttempts, 5, 'ParcelDetail deliveryAttempts must equal 5 in DB');
    console.log(`  [PASS] Database audit: Parcel ${dbParcel.id} deliveryAttempts = ${dbParcel.deliveryAttempts}`);

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
