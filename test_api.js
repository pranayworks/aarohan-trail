// Automated API verification for Gaman Lilongwe Real-Time Backend
async function test() {
  const baseUrl = 'http://localhost:3000';
  console.log('--- 1. Testing Forward Search (/api/places/search?q=EPTL) ---');
  try {
    const res = await fetch(`${baseUrl}/api/places/search?q=EPTL`);
    const data = await res.json();
    console.log(`Found ${data.length} results for EPTL:`, data.slice(0, 2));
  } catch (err) {
    console.error('Search error:', err);
  }

  console.log('\n--- 2. Testing Reverse Geocoding (/api/places/reverse?lat=-13.9722&lng=33.7667) ---');
  try {
    const res = await fetch(`${baseUrl}/api/places/reverse?lat=-13.9722&lng=33.7667`);
    const data = await res.json();
    console.log('Reverse geocode result:', data);
  } catch (err) {
    console.error('Reverse error:', err);
  }

  console.log('\n--- 3. Testing Real Quote (/api/rides/quote) ---');
  let quoteId = null;
  try {
    const res = await fetch(`${baseUrl}/api/rides/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: { lat: -13.9722, lng: 33.7667, address: 'Gateway Mall, Lilongwe' },
        destination: { lat: -13.9850, lng: 33.7750, address: 'Old Town Mall, Lilongwe' }
      })
    });
    const quote = await res.json();
    quoteId = quote.quoteId;
    console.log('Quote generated:', {
      quoteId: quote.quoteId,
      distanceKm: quote.route.distanceKm,
      durationMins: quote.route.durationMins,
      polylinePoints: quote.route.polyline.length,
      tiers: Object.keys(quote.tiers).map(k => ({
        id: k,
        name: quote.tiers[k].name,
        finalFare: quote.tiers[k].finalFare,
        platformFee: quote.tiers[k].platformFee,
        driverNet: quote.tiers[k].driverNetEarnings
      }))
    });
  } catch (err) {
    console.error('Quote error:', err);
  }

  console.log('\n--- 4. Testing Driver Telemetry & Spatial Search ---');
  try {
    // Post driver location
    await fetch(`${baseUrl}/api/drivers/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        driverId: 'DRV-MW-001',
        name: 'Chikondi Phiri',
        phone: '+265 99 987 6543',
        vehicleTier: 'moto',
        vehiclePlate: 'BW 9821',
        vehicleModel: 'Haojue 125cc Red',
        lat: -13.9700,
        lng: 33.7650,
        heading: 90,
        accuracy: 5
      })
    });

    const nearbyRes = await fetch(`${baseUrl}/api/drivers/nearby?lat=-13.9722&lng=33.7667&radiusKm=5`);
    const nearby = await nearbyRes.json();
    console.log(`Nearby drivers found (${nearby.count}):`, nearby.drivers.map(d => ({
      name: d.name,
      tier: d.vehicleTier || d.vehicleType,
      distKm: d.distanceKm
    })));
  } catch (err) {
    console.error('Driver telemetry error:', err);
  }

  console.log('\n--- 5. Testing Saved & Frequent Places ---');
  try {
    const saved = await (await fetch(`${baseUrl}/api/user/saved-places`)).json();
    console.log('Saved places count:', saved.length);
    const frequent = await (await fetch(`${baseUrl}/api/user/frequent-places`)).json();
    console.log('Frequent places count:', frequent.length, frequent);
  } catch (err) {
    console.error('Places error:', err);
  }

  console.log('\n--- 6. Testing Admin Metrics ---');
  try {
    const metrics = await (await fetch(`${baseUrl}/api/admin/metrics`)).json();
    console.log('Admin metrics:', metrics);
  } catch (err) {
    console.error('Metrics error:', err);
  }
}

test();
