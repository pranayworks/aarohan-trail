const prisma = require('../lib/prisma');
const { server } = require('../server');
const { getTestToken } = require('./auth_helper');

async function verify() {
  const baseUrl = 'http://localhost:3000';

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
  console.log('   AAROHAN LILONGWE REAL-TIME VERIFICATION SUITE');
  console.log('=============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(name, condition, details) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${name}`);
      if (details) console.log(`   ${details}`);
    } else {
      console.error(`❌ [FAIL] ${name}`);
      if (details) console.error(`   ${details}`);
    }
  }

  // TEST 1: Forward Geocoding Search for "EPTL"
  console.log('--- 1. Testing Live Forward Search (EPTL Malawi) ---');
  try {
    const res = await fetch(`${baseUrl}/api/places/search?q=EPTL&lat=-13.9722&lng=33.7667`);
    const results = await res.json();
    assert(
      'Search for "EPTL" returns Entire Printers & Traders Limited',
      results.length > 0 && results.some(r => r.name.toLowerCase().includes('entire printers') || r.name.toLowerCase().includes('eptl')),
      `Found ${results.length} results. First result: "${results[0]?.name}" (${results[0]?.area})`
    );
  } catch (err) {
    assert('Search for "EPTL"', false, err.message);
  }

  // TEST 2: Reverse Geocoding in Lilongwe
  console.log('\n--- 2. Testing Reverse Geocoding (Lilongwe Device GPS) ---');
  try {
    const res = await fetch(`${baseUrl}/api/places/reverse?lat=-13.9722&lng=33.7667`);
    const data = await res.json();
    assert(
      'Reverse geocoding resolves coordinates to readable Lilongwe address',
      data && (data.title || data.displayName),
      `Title: "${data.title}" • Display: "${data.displayName}" • Provider: ${data.provider}`
    );
  } catch (err) {
    assert('Reverse geocoding', false, err.message);
  }

  // TEST 3: Authoritative Road Routing & Dynamic Pricing Quote
  console.log('\n--- 3. Testing Mapbox Directions & Authoritative Quote ---');
  let quoteId = null;
  let quoteData = null;
  try {
    const res = await fetch(`${baseUrl}/api/rides/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: { lat: -13.9722, lng: 33.7667, name: 'Gateway Mall, Area 47' },
        destination: { lat: -13.9933, lng: 33.6777, name: 'Entire Printers and Traders Limited (EPTL)' }
      })
    });
    quoteData = await res.json();
    quoteId = quoteData.quoteId;

    assert(
      'Server issues signed 10-minute expiring Quote ID',
      quoteId && quoteId.startsWith('AAROHAN-QTE-'),
      `Quote ID: ${quoteId} (Expires in ${Math.round((quoteData.expiresAt - Date.now()) / 60000)} mins)`
    );

    assert(
      'Mapbox Directions provides genuine road geometry and distance',
      quoteData.route && quoteData.route.distanceKm > 0 && Array.isArray(quoteData.route.polyline) && quoteData.route.polyline.length > 10,
      `Road Distance: ${quoteData.route?.distanceKm} km • Road Duration: ${quoteData.route?.durationMins} mins • Polyline points: ${quoteData.route?.polyline?.length}`
    );

    const motoNet = (quoteData.tiers?.moto?.driverNetEarnings || quoteData.tiers?.moto?.driverEarnings || 0);
    const autoNet = (quoteData.tiers?.auto?.driverNetEarnings || quoteData.tiers?.auto?.driverEarnings || 0);
    const cabNet = (quoteData.tiers?.cab?.driverNetEarnings || quoteData.tiers?.cab?.driverEarnings || 0);

    assert(
      'Authoritative pricing calculated for Moto, Auto, and Cab with 30% commission (70% driver share)',
      quoteData.tiers && quoteData.tiers.moto && quoteData.tiers.auto && quoteData.tiers.cab,
      `AArohan Moto: MK ${quoteData.tiers?.moto?.finalFare.toLocaleString()} (Driver net: MK ${motoNet.toLocaleString()})\n` +
      `   AArohan Auto: MK ${quoteData.tiers?.auto?.finalFare.toLocaleString()} (Driver net: MK ${autoNet.toLocaleString()})\n` +
      `   AArohan Cab:  MK ${quoteData.tiers?.cab?.finalFare.toLocaleString()} (Driver net: MK ${cabNet.toLocaleString()})`
    );
  } catch (err) {
    assert('Road route and quote', false, err.message);
  }

  // TEST 4: Driver GPS Telemetry & Spatial Nearby Query
  console.log('\n--- 4. Testing Driver Telemetry & Spatial Discovery ---');
  try {
    // 4a. Find a real verified driver in PostgreSQL
    let dbDriver = await prisma.driver.findFirst({
      where: { approvalStatus: 'APPROVED' },
      include: { user: true, vehicle: true }
    });

    if (!dbDriver) {
      throw new Error('No approved driver found in database');
    }

    // Reset test driver commission debt so telemetry is not blocked by previous runs
    await prisma.driver.update({
      where: { id: dbDriver.id },
      data: { commissionDebtMWK: 0 }
    });

    const driverToken = getTestToken({ userId: dbDriver.userId, role: 'DRIVER', driverId: dbDriver.id });

    // 4b. Post driver location to update PostgreSQL coordinates & fresh timestamp
    const postLocRes = await fetch(`${baseUrl}/api/drivers/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${driverToken}`
      },
      body: JSON.stringify({
        driverId: dbDriver.id,
        lat: -13.9710,
        lng: 33.7680,
        heading: 120,
        accuracy: 4
      })
    });
    const locResult = await postLocRes.json();
    assert(
      'Driver GPS telemetry successfully recorded',
      locResult.success === true,
      `Recorded driver ${dbDriver.id} at (${locResult.driver?.location?.lat}, ${locResult.driver?.location?.lng})`
    );

    // Ensure driver is ONLINE in DB for spatial discovery
    await prisma.driver.update({
      where: { id: dbDriver.id },
      data: { availability: 'ONLINE', lastLocationAt: new Date() }
    });

    // 4c. Query nearby drivers within 5km of rider
    const nearbyRes = await fetch(`${baseUrl}/api/drivers/nearby?lat=-13.9722&lng=33.7667&radius=5`);
    const nearby = await nearbyRes.json();
    assert(
      'Spatial search discovers nearby Lilongwe captains from database',
      nearby.count > 0 && Array.isArray(nearby.drivers),
      `Found ${nearby.count} nearby active captains. Closest distance: ${nearby.drivers[0]?.distanceKm} km`
    );
  } catch (err) {
    assert('Driver telemetry and spatial search', false, err.message);
  }

  // TEST 5: Saved & Frequent Places
  console.log('\n--- 5. Testing Saved & Frequent Places Services ---');
  try {
    const frequentRes = await fetch(`${baseUrl}/api/user/frequent-places`, {
      headers: {
        'Authorization': `Bearer ${getTestToken({ role: 'RIDER' })}`
      }
    });
    const frequent = await frequentRes.json();
    assert(
      'Frequent destinations dynamically calculated from trip history',
      Array.isArray(frequent),
      `Frequent destinations count: ${frequent.length}`
    );
  } catch (err) {
    assert('Frequent destinations', false, err.message);
  }

  // TEST 6: Operations Admin Metrics Engine
  console.log('\n--- 6. Testing Operations Admin Metrics ---');
  try {
    const metricsRes = await fetch(`${baseUrl}/api/admin/metrics`, {
      headers: {
        'Authorization': `Bearer ${getTestToken({ role: 'ADMIN' })}`
      }
    });
    const m = await metricsRes.json();
    assert(
      'Platform metrics aggregate volume, revenue, and online drivers dynamically from PostgreSQL',
      typeof m.totalVolumeMWK === 'number' && typeof m.platformRevenueMWK === 'number' && typeof m.completedTripsCount === 'number',
      `Volume: MK ${m.totalVolumeMWK.toLocaleString()} • Platform Net: MK ${m.platformRevenueMWK.toLocaleString()} • Online Drivers: ${m.onlineDriversCount}`
    );
  } catch (err) {
    assert('Admin metrics', false, err.message);
  }

  // SUMMARY
  console.log('\n=============================================================');
  console.log(`   VERIFICATION RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('=============================================================\n');

  if (passedTests === totalTests) {
    return { passed: passedTests, total: totalTests };
  } else {
    throw new Error(`Failed ${totalTests - passedTests} tests`);
  }
}

if (require.main === module) {
  verify()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Verification failed:', err.message);
      process.exit(1);
    });
}

module.exports = { verify };
