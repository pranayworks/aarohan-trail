// ============================================================================
// AAROHAN LOCAL BENCHMARK & LOAD TEST • PRODUCTION READINESS
// ============================================================================
// Simulates 50 concurrent Riders and 20 concurrent Drivers against a LOCAL server.
// Measures request latency (min, max, mean, p50, p95, p99), errors, and DB connections.
// STRICT SAFETY: Aborts immediately if configured against any non-local host.
// ============================================================================

require('dotenv').config();
const { server } = require('../server');
const prisma = require('../lib/prisma');
const { getTestToken } = require('./auth_helper');

const LOCAL_TARGET = 'http://127.0.0.1:3000';

// STRICT SAFETY GUARD: Never run against remote servers
const parsedUrl = new URL(LOCAL_TARGET);
if (parsedUrl.hostname !== 'localhost' && parsedUrl.hostname !== '127.0.0.1') {
  console.error('FATAL SAFETY VIOLATION: Load test must ONLY run against a local server.');
  process.exit(1);
}

function calculatePercentiles(latencies) {
  if (!latencies.length) return { min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = Math.round(sum / sorted.length);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    p50,
    p95,
    p99
  };
}

async function runLocalLoadTest() {
  console.log('=============================================================');
  console.log('   AAROHAN LOCAL HIGH-CONCURRENCY LOAD BENCHMARK');
  console.log('   Target: LOCALHOST ONLY (50 Riders + 20 Drivers)');
  console.log('=============================================================\n');

  let serverStarted = false;
  if (!server.listening) {
    console.log('[Setup] Starting local server on port 3000...');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(3000, '127.0.0.1', () => {
        serverStarted = true;
        resolve();
      });
    });
  }

  // Measure initial DB connections
  let initialDbConnections = 0;
  try {
    const connResult = await prisma.$queryRaw`
      SELECT count(*)::int as count FROM pg_stat_activity WHERE state = 'active' OR state = 'idle';
    `;
    initialDbConnections = connResult[0]?.count || 0;
  } catch (e) {
    // Some pooled proxies don't support pg_stat_activity
    initialDbConnections = 1;
  }
  console.log(`[DB Pool] Initial Active/Idle Database Connections: ${initialDbConnections}`);

  // Fetch or setup driver fixtures for telemetry simulation
  const approvedDrivers = await prisma.driver.findMany({
    where: { approvalStatus: 'APPROVED' },
    take: 20,
    include: { user: true }
  });

  const driverTokens = approvedDrivers.map(d =>
    getTestToken({ userId: d.userId, role: 'DRIVER', driverId: d.id })
  );

  const riderToken = getTestToken({ role: 'RIDER' });

  const endpointLatencies = {
    quote: [],
    driverLocation: [],
    nearbyDrivers: [],
    placesSearch: []
  };

  let totalRequests = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  console.log(`\n⏳ Simulating 20 Drivers reporting GPS telemetry concurrently...`);
  const driverTasks = [];
  for (let i = 0; i < 20; i++) {
    const driver = approvedDrivers[i % approvedDrivers.length] || { id: `DRV-TEST-${i}` };
    const token = driverTokens[i % driverTokens.length] || riderToken;

    driverTasks.push(async () => {
      for (let cycle = 0; cycle < 3; cycle++) {
        totalRequests++;
        const t0 = Date.now();
        try {
          const res = await fetch(`${LOCAL_TARGET}/api/drivers/location`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              driverId: driver.id,
              lat: -13.9700 + (i * 0.001) + (cycle * 0.0001),
              lng: 33.7650 + (i * 0.001) + (cycle * 0.0001),
              heading: 90,
              speed: 25
            })
          });
          const dur = Date.now() - t0;
          endpointLatencies.driverLocation.push(dur);
          if (!res.ok) totalErrors++;
        } catch (err) {
          totalErrors++;
        }
      }
    });
  }

  console.log(`⏳ Simulating 50 Riders requesting quotes, search & nearby drivers concurrently...`);
  const riderTasks = [];
  for (let i = 0; i < 50; i++) {
    riderTasks.push(async () => {
      // 1. Nearby drivers query
      totalRequests++;
      let t0 = Date.now();
      try {
        const res = await fetch(`${LOCAL_TARGET}/api/drivers/nearby?lat=-13.9722&lng=33.7667&radius=5`);
        endpointLatencies.nearbyDrivers.push(Date.now() - t0);
        if (!res.ok) totalErrors++;
      } catch (err) {
        totalErrors++;
      }

      // 2. Road quote request
      totalRequests++;
      t0 = Date.now();
      try {
        const res = await fetch(`${LOCAL_TARGET}/api/rides/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pickup: { lat: -13.9722, lng: 33.7667, name: 'Gateway Mall' },
            destination: { lat: -13.9933 + (i * 0.0002), lng: 33.6777 + (i * 0.0002), name: 'Lilongwe Destination' }
          })
        });
        endpointLatencies.quote.push(Date.now() - t0);
        if (!res.ok) totalErrors++;
      } catch (err) {
        totalErrors++;
      }

      // 3. Search query
      totalRequests++;
      t0 = Date.now();
      try {
        const res = await fetch(`${LOCAL_TARGET}/api/places/search?q=Area&lat=-13.9722&lng=33.7667`);
        endpointLatencies.placesSearch.push(Date.now() - t0);
        if (!res.ok) totalErrors++;
      } catch (err) {
        totalErrors++;
      }
    });
  }

  // Execute all concurrent driver and rider tasks
  await Promise.all([...driverTasks.map(fn => fn()), ...riderTasks.map(fn => fn())]);

  const totalDurationMs = Date.now() - startTime;

  // Measure peak DB connections
  let peakDbConnections = initialDbConnections;
  try {
    const connResult = await prisma.$queryRaw`
      SELECT count(*)::int as count FROM pg_stat_activity WHERE state = 'active' OR state = 'idle';
    `;
    peakDbConnections = connResult[0]?.count || initialDbConnections;
  } catch (e) {}

  const allLatencies = [
    ...endpointLatencies.quote,
    ...endpointLatencies.driverLocation,
    ...endpointLatencies.nearbyDrivers,
    ...endpointLatencies.placesSearch
  ];

  const overall = calculatePercentiles(allLatencies);
  const quoteStats = calculatePercentiles(endpointLatencies.quote);
  const locStats = calculatePercentiles(endpointLatencies.driverLocation);
  const nearbyStats = calculatePercentiles(endpointLatencies.nearbyDrivers);
  const searchStats = calculatePercentiles(endpointLatencies.placesSearch);

  console.log('\n=============================================================');
  console.log('   BENCHMARK PERFORMANCE RESULTS');
  console.log('=============================================================');
  console.log(`Total Requests:         ${totalRequests}`);
  console.log(`Successful Requests:    ${totalRequests - totalErrors}`);
  console.log(`Failed Requests:        ${totalErrors} (${((totalErrors / totalRequests) * 100).toFixed(2)}%)`);
  console.log(`Elapsed Wall Time:      ${totalDurationMs} ms`);
  console.log(`Throughput:             ${Math.round((totalRequests / (totalDurationMs / 1000)))} req/sec`);
  console.log(`DB Connection Count:    Initial: ${initialDbConnections} • Peak: ${peakDbConnections}`);
  console.log('-------------------------------------------------------------');
  console.log(`Overall Latency:        min: ${overall.min}ms | p50: ${overall.p50}ms | p95: ${overall.p95}ms | p99: ${overall.p99}ms | max: ${overall.max}ms`);
  console.log(`  - /api/rides/quote:   p50: ${quoteStats.p50}ms | p95: ${quoteStats.p95}ms | p99: ${quoteStats.p99}ms`);
  console.log(`  - /drivers/location:  p50: ${locStats.p50}ms | p95: ${locStats.p95}ms | p99: ${locStats.p99}ms`);
  console.log(`  - /drivers/nearby:    p50: ${nearbyStats.p50}ms | p95: ${nearbyStats.p95}ms | p99: ${nearbyStats.p99}ms`);
  console.log(`  - /places/search:     p50: ${searchStats.p50}ms | p95: ${searchStats.p95}ms | p99: ${searchStats.p99}ms`);
  console.log('=============================================================\n');

  if (serverStarted) {
    server.close();
  }

  return {
    totalRequests,
    totalErrors,
    throughputReqSec: Math.round((totalRequests / (totalDurationMs / 1000))),
    overall
  };
}

if (require.main === module) {
  runLocalLoadTest()
    .then((res) => {
      if (res.totalErrors > 0 && res.totalErrors / res.totalRequests > 0.05) {
        console.error('❌ Load test error rate exceeded 5% threshold.');
        process.exit(1);
      }
      console.log('✅ Local load benchmark completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Load test failed:', err);
      process.exit(1);
    });
}

module.exports = { runLocalLoadTest };

