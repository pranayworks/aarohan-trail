// ============================================================================
// AAROHAN TASK 3 TEST SUITE: SERVER RULES
// Tests:
// 1. Service area bounding box validation (Lilongwe boundary enforcement)
//    - Rejection of pickup outside bbox (400 OUTSIDE_SERVICE_AREA)
//    - Rejection of dropoff outside bbox (400 OUTSIDE_SERVICE_AREA)
//    - Rejection of intermediate stop outside bbox (400 OUTSIDE_SERVICE_AREA)
// 2. PricingConfig table persistence & version history
//    - Stop fee & parcel multipliers live in PricingConfig and active in DB
//    - Stop fee reflected in fare calculations
//    - Parcel size multipliers reflected in quote calculations
//    - Admin API allows creating new version history (not hardcoded)
// ============================================================================

require('dotenv').config();
const http = require('http');
const assert = require('assert');
const prisma = require('../lib/prisma');
const pricingService = require('../services/pricing');
const { getTestToken } = require('./auth_helper');
const { server, app } = require('../server');

const TEST_PORT = 3092;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Lilongwe center coordinates (valid)
const LILONGWE_PICKUP = { lat: -13.9833, lng: 33.7833, address: 'Old Town Mall, Lilongwe' };
const LILONGWE_DROPOFF = { lat: -13.9630, lng: 33.7741, address: 'Gateway Mall, Lilongwe' };
const LILONGWE_STOP = { lat: -13.9700, lng: 33.7780, address: 'Area 3 Stop, Lilongwe' };

// Outside coordinates (Blantyre & Mzuzu)
const OUTSIDE_BLANTYRE = { lat: -15.7861, lng: 35.0058, address: 'Chichiri, Blantyre' };
const OUTSIDE_MZUZU = { lat: -11.4656, lng: 34.0207, address: 'Mzuzu Clocktower' };

async function runServerRulesSuite() {
  console.log('=============================================================');
  console.log('   AAROHAN TASK 3: SERVER RULES & PRICING CONFIG SUITE');
  console.log('   Lilongwe, Malawi • Geofence Bounds & Tariff Versioning');
  console.log('=============================================================\n');

  let passed = 0, total = 0;

  function report(name, cond, detail = '') {
    total++;
    if (cond) {
      passed++;
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      if (detail) console.log(`   └─ ${detail}`);
    } else {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      if (detail) console.error(`   └─ ${detail}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(TEST_PORT, '127.0.0.1', resolve);
    });
  }

  const token = await getTestToken();

  try {
    // -------------------------------------------------------------------------
    // 1. GEOFENCE BOUNDS: SERVICE AREA BOUNDING BOX REJECTIONS
    // -------------------------------------------------------------------------
    console.log('--- 1. Service Area Bounding Box Enforcement ---');

    // Test 1: Pickup outside Lilongwe -> 400 OUTSIDE_SERVICE_AREA
    const res1 = await fetch(`${BASE_URL}/api/rides/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pickup: OUTSIDE_BLANTYRE,
        dropoff: LILONGWE_DROPOFF
      })
    });
    const data1 = await res1.json();
    report(
      'Pickup outside Lilongwe rejected with 400 OUTSIDE_SERVICE_AREA',
      res1.status === 400 && data1.code === 'OUTSIDE_SERVICE_AREA',
      `Status: ${res1.status}, code: ${data1.code}, message: "${data1.error}"`
    );

    // Test 2: Dropoff outside Lilongwe -> 400 OUTSIDE_SERVICE_AREA
    const res2 = await fetch(`${BASE_URL}/api/rides/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pickup: LILONGWE_PICKUP,
        dropoff: OUTSIDE_BLANTYRE
      })
    });
    const data2 = await res2.json();
    report(
      'Dropoff outside Lilongwe rejected with 400 OUTSIDE_SERVICE_AREA',
      res2.status === 400 && data2.code === 'OUTSIDE_SERVICE_AREA',
      `Status: ${res2.status}, code: ${data2.code}`
    );

    // Test 3: Intermediate stop outside Lilongwe -> 400 OUTSIDE_SERVICE_AREA
    const res3 = await fetch(`${BASE_URL}/api/rides/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pickup: LILONGWE_PICKUP,
        dropoff: LILONGWE_DROPOFF,
        stops: [OUTSIDE_MZUZU]
      })
    });
    const data3 = await res3.json();
    report(
      'Intermediate stop outside Lilongwe rejected with 400 OUTSIDE_SERVICE_AREA',
      res3.status === 400 && data3.code === 'OUTSIDE_SERVICE_AREA',
      `Status: ${res3.status}, code: ${data3.code}`
    );

    // Test 4: Fully within Lilongwe -> 200 with valid quote
    const res4 = await fetch(`${BASE_URL}/api/rides/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pickup: LILONGWE_PICKUP,
        dropoff: LILONGWE_DROPOFF,
        stops: [LILONGWE_STOP]
      })
    });
    const data4 = await res4.json();
    const tierCount = data4.tiers ? Object.keys(data4.tiers).length : 0;
    report(
      'Pickup, stops, and dropoff inside Lilongwe produce valid 200 quote',
      res4.status === 200 && tierCount > 0,
      `Received ${tierCount} vehicle tiers (${Object.keys(data4.tiers || {}).join(', ')}). Road distance: ${data4.route?.distanceKm} km`
    );

    // -------------------------------------------------------------------------
    // 2. PRICING CONFIG: STOP FEE AND PARCEL MULTIPLIERS IN DB
    // -------------------------------------------------------------------------
    console.log('\n--- 2. PricingConfig Database Persistence & History ---');

    await pricingService.syncFromDatabase();
    const activeVersion = pricingService.getActiveVersion();

    report(
      'PricingConfig active version has stopFeeMWK and parcel multipliers',
      typeof activeVersion.stopFeeMWK === 'number' &&
      typeof activeVersion.parcelSmallMult === 'number' &&
      typeof activeVersion.parcelMediumMult === 'number' &&
      typeof activeVersion.parcelLargeMult === 'number',
      `stopFeeMWK: ${activeVersion.stopFeeMWK}, small: ${activeVersion.parcelSmallMult}, medium: ${activeVersion.parcelMediumMult}, large: ${activeVersion.parcelLargeMult}`
    );

    // Test 6: Verify stop fee is added to fare calculation
    const fareNoStops = pricingService.calculateFare({
      categoryId: 'cab',
      distanceKm: 5,
      durationMins: 10,
      stopCount: 0
    });
    const fareWith2Stops = pricingService.calculateFare({
      categoryId: 'cab',
      distanceKm: 5,
      durationMins: 10,
      stopCount: 2
    });
    const expectedStopDelta = activeVersion.stopFeeMWK * 2;
    report(
      'Fare calculation adds exact stopFeeMWK * stopCount',
      fareWith2Stops.stopFee === expectedStopDelta && fareWith2Stops.finalFare === fareNoStops.finalFare + expectedStopDelta,
      `No stops: MK ${fareNoStops.finalFare}, 2 stops: MK ${fareWith2Stops.finalFare} (stop fee component: MK ${fareWith2Stops.stopFee})`
    );

    // Test 7: Verify parcel multipliers apply properly
    const parcelSmall = pricingService.calculateFare({
      categoryId: 'moto',
      distanceKm: 5,
      durationMins: 10,
      serviceType: 'PARCEL',
      parcelSize: 'SMALL'
    });
    const parcelLarge = pricingService.calculateFare({
      categoryId: 'moto',
      distanceKm: 5,
      durationMins: 10,
      serviceType: 'PARCEL',
      parcelSize: 'LARGE'
    });
    report(
      'Parcel size multipliers scale courier fares (Large > Small)',
      parcelLarge.finalFare > parcelSmall.finalFare && parcelLarge.breakdown?.parcelMultiplier === activeVersion.parcelLargeMult,
      `Small (mult ${parcelSmall.breakdown?.parcelMultiplier}): MK ${parcelSmall.finalFare}, Large (mult ${parcelLarge.breakdown?.parcelMultiplier}): MK ${parcelLarge.finalFare}`
    );

    // -------------------------------------------------------------------------
    // 3. ADMIN TARIFF EDITING & VERSION HISTORY PRESERVATION
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Admin Tariff API & Version History Preservation ---');

    const adminToken = getTestToken({ role: 'ADMIN' });
    const initialVersionCount = (await prisma.pricingConfig.findMany()).length;

    // Test 8: Admin POST /api/pricing/global creates new version in DB
    const newStopFee = (activeVersion.stopFeeMWK || 500) + 100;
    const resUpdate = await fetch(`${BASE_URL}/api/pricing/global`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        stopFeeMWK: newStopFee,
        parcelSmallMult: 1.05,
        parcelMediumMult: 1.40,
        parcelLargeMult: 1.85,
        versionName: `Test Audit Tariff ${Date.now()}`,
        adminId: 'ADMIN_TEST_RUNNER'
      })
    });
    const updateJson = await resUpdate.json();

    report(
      'Admin POST /api/pricing/global successfully creates and activates new version',
      resUpdate.status === 200 && updateJson.success && updateJson.result?.stopFeeMWK === newStopFee,
      `New versionId: ${updateJson.result?.versionId}, stopFee: MK ${updateJson.result?.stopFeeMWK}`
    );

    // Test 9: Verify history is preserved (old versions not deleted from DB)
    const dbVersions = await prisma.pricingConfig.findMany({
      orderBy: { createdAt: 'desc' }
    });
    report(
      'PricingConfig retains full version history in database (not overwritten)',
      dbVersions.length >= initialVersionCount + 1 && dbVersions.some(v => v.isActive === true),
      `Total versions in DB: ${dbVersions.length}. Active version: ${dbVersions.find(v => v.isActive)?.versionId}`
    );

    // Test 10: GET /api/pricing/versions returns version history list
    const resList = await fetch(`${BASE_URL}/api/pricing/versions`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const versionsList = await resList.json();
    report(
      'GET /api/pricing/versions returns list with stop fee and parcel attributes',
      resList.status === 200 && Array.isArray(versionsList) && versionsList[0].stopFeeMWK === newStopFee,
      `Returned ${versionsList.length} version history records`
    );

    // Test 11: Activate an older version or switch back to ensure activateVersion functions properly
    const olderVersion = dbVersions.find(v => !v.isActive);
    if (olderVersion) {
      const resActivate = await fetch(`${BASE_URL}/api/pricing/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          versionId: olderVersion.versionId,
          adminId: 'ADMIN_TEST_RUNNER'
        })
      });
      const actJson = await resActivate.json();
      report(
        'POST /api/pricing/activate successfully switches active version in DB',
        resActivate.status === 200 && actJson.success && actJson.activated?.versionId === olderVersion.versionId,
        `Switched active version to: ${olderVersion.versionId}`
      );
    } else {
      report('POST /api/pricing/activate skipped (no previous version to toggle)', true);
    }

    // Test 12: Admin UI pricing editing lifecycle: fetch active -> edit stop fee & parcel mults -> verify version history
    const activePricingRes = await fetch(`${BASE_URL}/api/pricing/active`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const currentActivePricing = await activePricingRes.json();
    const editedStopFee = 750;
    const editedSmallMult = 1.15;
    const editedMediumMult = 1.45;
    const editedLargeMult = 1.95;

    const savePricingRes = await fetch(`${BASE_URL}/api/pricing/global`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        stopFeeMWK: editedStopFee,
        parcelSmallMult: editedSmallMult,
        parcelMediumMult: editedMediumMult,
        parcelLargeMult: editedLargeMult,
        versionName: `Admin UI Edit ${Date.now()}`,
        adminId: 'ADMIN_SUPER'
      })
    });
    const savePricingJson = await savePricingRes.json();

    const historyRes = await fetch(`${BASE_URL}/api/pricing/versions`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const historyList = await historyRes.json();
    const latestVersion = historyList[0];

    const fareCheck = pricingService.calculateFare({
      categoryId: 'moto',
      distanceKm: 5,
      durationMins: 10,
      stopCount: 1,
      serviceType: 'PARCEL',
      parcelSize: 'LARGE'
    });

    report(
      'Admin pricing screen editing workflow: stop fee and parcel multipliers save and create new history version',
      savePricingRes.status === 200 &&
      latestVersion.stopFeeMWK === editedStopFee &&
      latestVersion.parcelLargeMult === editedLargeMult &&
      historyList.length >= 2 &&
      fareCheck.stopFee === editedStopFee &&
      fareCheck.breakdown?.parcelMultiplier === editedLargeMult,
      `Saved Version ${latestVersion.versionId}: stopFee=MK ${latestVersion.stopFeeMWK}, parcelLarge=${latestVersion.parcelLargeMult}x, historyCount=${historyList.length}`
    );

    // -------------------------------------------------------------------------
    // 4. Production Environment Isolation & Feature Flags (Section 11)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Production Environment Isolation & Feature Flags ---');
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const PROD_PORT = 3095;
    const prodServer = http.createServer(app);
    await new Promise((resolve) => prodServer.listen(PROD_PORT, resolve));

    try {
      // Test 13: GET /api/app-config with NODE_ENV=production returns allowLocationSimulation: false
      const prodConfigRes = await fetch(`http://127.0.0.1:${PROD_PORT}/api/app-config`);
      const prodConfig = await prodConfigRes.json();
      report(
        'GET /api/app-config with NODE_ENV=production has allowLocationSimulation=false',
        prodConfigRes.status === 200 && prodConfig.allowLocationSimulation === false && prodConfig.env === 'production',
        `env=${prodConfig.env}, allowLocationSimulation=${prodConfig.allowLocationSimulation}`
      );

      // Test 14: /prototypes directory is blocked (404) in production
      const prodPrototypesRes = await fetch(`http://127.0.0.1:${PROD_PORT}/prototypes/driver-earnings.html`);
      report(
        '/prototypes is strictly blocked (404) when NODE_ENV=production',
        prodPrototypesRes.status === 404,
        `Status: ${prodPrototypesRes.status}`
      );

      // Test 15: Rider HTML contains #btn-dev-simulate-location as hidden by default
      const riderHtmlRes = await fetch(`http://127.0.0.1:${PROD_PORT}/rider/index.html`);
      const riderHtml = await riderHtmlRes.text();
      const hasSimulateBtnHidden = riderHtml.includes('id="btn-dev-simulate-location"') && riderHtml.includes('hidden');
      report(
        'Rider UI keeps simulate location button hidden by default in production',
        riderHtmlRes.status === 200 && hasSimulateBtnHidden,
        'Simulate button marked hidden'
      );
    } finally {
      if (prodServer.listening) {
        await new Promise(r => prodServer.close(r));
      }
      process.env.NODE_ENV = origEnv;
    }

    console.log('\n=============================================================');
    console.log(`   TASK 3 SERVER RULES: ALL ${passed}/${total} TESTS PASSED (100%)`);
    console.log('=============================================================\n');

  } finally {
    // Teardown: Restore original database tariffs (stopFeeMWK: 500, parcel multipliers: 1.0, 1.35, 1.80)
    try {
      if (typeof pricingService.updateGlobalTariffs === 'function') {
        await pricingService.updateGlobalTariffs({
          stopFeeMWK: 500,
          parcelSmallMult: 1.0,
          parcelMediumMult: 1.35,
          parcelLargeMult: 1.80,
          versionName: 'Default Restored (Teardown)'
        }, 'ADMIN_TEARDOWN');
      }
    } catch (e) {
      console.warn('[Teardown] Could not restore original pricing tariffs:', e.message);
    }

    if (server.listening) {
      await new Promise(r => server.close(r));
    }
  }
}

if (require.main === module) {
  runServerRulesSuite().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
  });
}

module.exports = { runServerRulesSuite };
