// ============================================================================
// AAROHAN PACKAGE 1 TEST SUITE
// Tests: Bidirectional ratings, support tickets, getFullTripRecord, audit log
// Lilongwe, Malawi • Package 1 Verification
// ============================================================================

require('dotenv').config();
const assert = require('assert');
const prisma = require('../lib/prisma');
const ratingService = require('../services/rating');
const ticketService = require('../services/supportTicket');
const { getFullTripRecord, logAdminTripAccess } = require('../services/tripRecord');
const { getTestToken } = require('./auth_helper');
const { server, app } = require('../server');

const TEST_PORT = 3091;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runPkg1Suite() {
  console.log('=============================================================');
  console.log('   AAROHAN PACKAGE 1: DB LEGAL/SAFETY RECORDS SUITE');
  console.log('   Lilongwe, Malawi • Ratings, Tickets, Trip Record, Audit');
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

  // -------------------------------------------------------------------------
  // Find or create test data
  // -------------------------------------------------------------------------
  let testTrip = await prisma.trip.findFirst({
    where: { status: 'COMPLETED' },
    include: { rider: true, driver: { include: { user: true } } }
  });

  if (!testTrip) {
    console.log('⚠️  No completed trip found in DB — skipping DB-dependent rating tests');
  }

  // -------------------------------------------------------------------------
  // 1. SCHEMA COLUMNS EXIST
  // -------------------------------------------------------------------------
  console.log('--- 1. Schema Column Tests ---');

  // User riderRating + ratingCount
  const userCols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'User'
    AND column_name IN ('riderRating', 'ratingCount')`;
  report('User table has riderRating column', userCols.some(c => c.column_name === 'riderRating'));
  report('User table has ratingCount column', userCols.some(c => c.column_name === 'ratingCount'));

  // Driver ratingCount
  const driverCols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Driver'
    AND column_name = 'ratingCount'`;
  report('Driver table has ratingCount column', driverCols.length > 0);

  // Trip new columns
  const tripCols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Trip'
    AND column_name IN ('serviceType', 'stopCount', 'stopFeeMWK')`;
  report('Trip table has serviceType column', tripCols.some(c => c.column_name === 'serviceType'));
  report('Trip table has stopCount column',   tripCols.some(c => c.column_name === 'stopCount'));
  report('Trip table has stopFeeMWK column',  tripCols.some(c => c.column_name === 'stopFeeMWK'));

  // New tables exist
  for (const table of ['TripStop', 'TripLocationPoint', 'ParcelDetail', 'SupportTicket', 'TicketMessage', 'ConsentRecord']) {
    const rows = await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = ${table} AND table_schema = 'public'`;
    report(`Table ${table} exists`, rows.length > 0);
  }

  // -------------------------------------------------------------------------
  // 2. RATING SERVICE — bidirectional, one-per-trip, running averages
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Rating Service Tests ---');

  if (testTrip) {
    const riderUserId  = testTrip.riderId;
    const driverUserId = testTrip.driver?.user?.id;

    if (riderUserId && driverUserId && testTrip.id) {
      // Clean up any stale ratings from previous test runs
      await prisma.rating.deleteMany({ where: { tripId: testTrip.id } });
      // Reset running averages
      await prisma.user.update({ where: { id: riderUserId },   data: { riderRating: 5.0, ratingCount: 0 } });
      if (testTrip.driver?.id) {
        await prisma.driver.update({ where: { id: testTrip.driver.id }, data: { rating: 5.0, ratingCount: 0 } });
      }

      // Rider rates driver (4 stars)
      let result1;
      try {
        result1 = await ratingService.submitRating({
          tripId: testTrip.id,
          fromUserId: riderUserId,
          toUserId:   driverUserId,
          stars: 4,
          tags: ['Punctual'],
          comment: 'Good ride'
        });
        report('Rider can rate driver (RIDER_TO_DRIVER direction)',
          result1.direction === 'RIDER_TO_DRIVER' && result1.rating.stars === 4,
          `direction=${result1.direction}, stars=${result1.rating.stars}`);
      } catch (e) {
        report('Rider can rate driver', false, e.message);
      }

      // Check driver's ratingCount updated
      const driverAfter = await prisma.driver.findUnique({ where: { id: testTrip.driver.id } });
      report('Driver ratingCount incremented to 1 after rider rating',
        driverAfter?.ratingCount === 1, `ratingCount=${driverAfter?.ratingCount}`);
      report('Driver rating updated to 4.0 (was 5.0, 1 rating)',
        driverAfter?.rating === 4.0, `rating=${driverAfter?.rating}`);

      // Driver rates rider (3 stars)
      let result2;
      try {
        result2 = await ratingService.submitRating({
          tripId: testTrip.id,
          fromUserId: driverUserId,
          toUserId:   riderUserId,
          stars: 3,
          tags: []
        });
        report('Driver can rate rider (DRIVER_TO_RIDER direction)',
          result2.direction === 'DRIVER_TO_RIDER' && result2.rating.stars === 3,
          `direction=${result2.direction}, stars=${result2.rating.stars}`);
      } catch (e) {
        report('Driver can rate rider', false, e.message);
      }

      // Check user's ratingCount updated
      const userAfter = await prisma.user.findUnique({ where: { id: riderUserId } });
      report('User ratingCount incremented to 1 after driver rating',
        userAfter?.ratingCount === 1, `ratingCount=${userAfter?.ratingCount}`);
      report('User riderRating updated to 3.0',
        userAfter?.riderRating === 3.0, `riderRating=${userAfter?.riderRating}`);

      // Duplicate rating must be rejected
      let dupErr = null;
      try {
        await ratingService.submitRating({
          tripId: testTrip.id, fromUserId: riderUserId, toUserId: driverUserId, stars: 5
        });
      } catch (e) { dupErr = e; }
      report('Duplicate rating (same author, same trip) is rejected', !!dupErr, dupErr?.message);

      // Self-rating must be rejected
      let selfErr = null;
      try {
        await ratingService.submitRating({
          tripId: testTrip.id, fromUserId: riderUserId, toUserId: riderUserId, stars: 5
        });
      } catch (e) { selfErr = e; }
      report('Self-rating is rejected', !!selfErr, selfErr?.message);
    } else {
      console.log('   ⚠️  Skipping rating tests: test trip missing rider or driver user');
    }
  } else {
    console.log('   ⚠️  Skipping rating tests: no completed trip in DB');
  }

  // -------------------------------------------------------------------------
  // 3. SUPPORT TICKET SERVICE
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Support Ticket Tests ---');

  const testUser = await prisma.user.findFirst({ where: { role: 'RIDER' } });
  const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  if (testUser) {
    // Create ticket
    const ticket = await ticketService.createTicket({
      userId: testUser.id,
      category: 'PAYMENT_DISPUTE',
      subject: 'Double charged for ride',
      description: 'I was charged twice for the same trip via Airtel Money',
      priority: 'HIGH'
    });
    report('createTicket returns ticket with correct fields',
      ticket.id && ticket.status === 'OPEN' && ticket.category === 'PAYMENT_DISPUTE',
      `id=${ticket.id}, status=${ticket.status}`);

    // Audit log was written
    const auditLog = await prisma.auditLog.findFirst({
      where: { entityId: ticket.id, action: 'TICKET_CREATED' }
    });
    report('AuditLog TICKET_CREATED written on ticket creation', !!auditLog);

    // Add a rider message
    const msg1 = await ticketService.addTicketMessage({
      ticketId: ticket.id,
      authorId: testUser.id,
      authorRole: 'RIDER',
      body: 'This happened on trip ID: test-123'
    });
    report('Rider can add message to ticket', msg1.id && msg1.authorRole === 'RIDER',
      `messageId=${msg1.id}`);

    // Admin resolves ticket
    if (adminUser) {
      // Add admin reply
      const msg2 = await ticketService.addTicketMessage({
        ticketId: ticket.id,
        authorId: adminUser.id,
        authorRole: 'ADMIN',
        body: 'We are investigating and will refund within 24 hours.'
      });
      report('Admin can add reply to ticket', msg2.id && msg2.authorRole === 'ADMIN');

      const resolved = await ticketService.updateTicketStatus({
        ticketId: ticket.id,
        adminId: adminUser.id,
        status: 'RESOLVED',
        resolution: 'Duplicate charge confirmed and refunded.'
      });
      report('Admin can resolve ticket with resolution text',
        resolved.status === 'RESOLVED' && resolved.resolution !== null,
        `status=${resolved.status}`);

      const resolveAudit = await prisma.auditLog.findFirst({
        where: { entityId: ticket.id, action: 'TICKET_RESOLVED' }
      });
      report('AuditLog TICKET_RESOLVED written on resolution', !!resolveAudit);
    }

    // Invalid category rejected
    let catErr = null;
    try {
      await ticketService.createTicket({
        userId: testUser.id,
        category: 'INVALID_CAT',
        subject: 'test', description: 'test test test test'
      });
    } catch (e) { catErr = e; }
    report('Invalid ticket category is rejected', !!catErr, catErr?.message);

    // Via HTTP: POST /api/tickets
    const riderToken = getTestToken({ userId: testUser.id, role: 'RIDER' });
    const httpRes = await fetch(`${BASE_URL}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${riderToken}` },
      body: JSON.stringify({
        category: 'APP_ISSUE',
        subject: 'Map not loading',
        description: 'The map does not render on my Tecno phone. Tried clearing cache.'
      })
    });
    const httpData = await httpRes.json();
    report('POST /api/tickets creates ticket via HTTP',
      httpRes.status === 201 && httpData.success && httpData.ticket?.id,
      `status=${httpRes.status}, ticketId=${httpData.ticket?.id}`);

    // GET /api/tickets — list own tickets
    const listRes = await fetch(`${BASE_URL}/api/tickets`, {
      headers: { Authorization: `Bearer ${riderToken}` }
    });
    const listData = await listRes.json();
    report('GET /api/tickets returns rider\'s own tickets',
      listRes.status === 200 && Array.isArray(listData.tickets) && listData.tickets.length >= 1,
      `count=${listData.tickets?.length}`);

    // Admin list (requires ADMIN token)
    if (adminUser) {
      const adminToken = getTestToken({ userId: adminUser.id, role: 'ADMIN' });
      const adminListRes = await fetch(`${BASE_URL}/api/admin/tickets`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const adminListData = await adminListRes.json();
      report('GET /api/admin/tickets returns ticket list for admin',
        adminListRes.status === 200 && Array.isArray(adminListData.tickets),
        `count=${adminListData.tickets?.length}`);

      // Admin list audit log written
      const adminAudit = await prisma.auditLog.findFirst({
        where: { userId: adminUser.id, action: 'ADMIN_TICKETS_VIEWED' },
        orderBy: { createdAt: 'desc' }
      });
      report('AuditLog ADMIN_TICKETS_VIEWED written when admin lists tickets', !!adminAudit);
    }
  } else {
    console.log('   ⚠️  No RIDER user in DB — skipping ticket tests');
  }

  // -------------------------------------------------------------------------
  // 4. getFullTripRecord
  // -------------------------------------------------------------------------
  console.log('\n--- 4. getFullTripRecord Tests ---');

  if (testTrip) {
    const record = await getFullTripRecord(testTrip.id);
    report('getFullTripRecord returns a non-null record', !!record, `tripId=${testTrip.id}`);
    report('Full record includes trip.id', record?.trip?.id === testTrip.id);
    report('Full record includes rider', !!record?.trip?.rider);
    report('Full record includes statusHistory array', Array.isArray(record?.trip?.statusHistory));
    report('Full record includes stops array', Array.isArray(record?.trip?.stops));
    report('Full record includes locationPoints array', Array.isArray(record?.trip?.locationPoints));
    report('Full record includes chatMessages array', Array.isArray(record?.trip?.chatMessages));
    report('Full record includes ratings array', Array.isArray(record?.trip?.ratings));
    report('Full record includes ledgerEntries array', Array.isArray(record?.trip?.ledgerEntries));
    report('Full record includes supportTickets array', Array.isArray(record?.trip?.supportTickets));
    report('Full record has retentionExpiresAt', !!record?.retentionExpiresAt);

    // Admin access audit log
    if (adminUser) {
      await logAdminTripAccess(testTrip.id, adminUser.id, 'FULL_RECORD', '127.0.0.1', 'test-agent');
      const accessLog = await prisma.auditLog.findFirst({
        where: { entityId: testTrip.id, userId: adminUser.id, action: 'ADMIN_TRIP_RECORD_VIEWED' },
        orderBy: { createdAt: 'desc' }
      });
      report('logAdminTripAccess writes ADMIN_TRIP_RECORD_VIEWED AuditLog', !!accessLog);

      await logAdminTripAccess(testTrip.id, adminUser.id, 'GPS_TRAIL', '127.0.0.1', 'test-agent');
      const gpsLog = await prisma.auditLog.findFirst({
        where: { entityId: testTrip.id, userId: adminUser.id, action: 'ADMIN_GPS_TRAIL_VIEWED' },
        orderBy: { createdAt: 'desc' }
      });
      report('logAdminTripAccess writes ADMIN_GPS_TRAIL_VIEWED AuditLog', !!gpsLog);
    }

    // null for bad tripId
    const nullRecord = await getFullTripRecord('nonexistent-id-00000000');
    report('getFullTripRecord returns null for nonexistent tripId', nullRecord === null);
  } else {
    console.log('   ⚠️  No completed trip — skipping full record tests');
  }

  // -------------------------------------------------------------------------
  // 5. TripStop schema + constraint test
  // -------------------------------------------------------------------------
  console.log('\n--- 5. TripStop & New Column Tests ---');

  // Trip default serviceType
  if (testTrip) {
    const tFresh = await prisma.trip.findUnique({
      where: { id: testTrip.id },
      select: { serviceType: true, stopCount: true, stopFeeMWK: true }
    });
    report('Existing trip has serviceType RIDE (default)',
      tFresh?.serviceType === 'RIDE', `serviceType=${tFresh?.serviceType}`);
    report('Existing trip has stopCount=0 (default)',
      tFresh?.stopCount === 0, `stopCount=${tFresh?.stopCount}`);
    report('Existing trip has stopFeeMWK=0 (default)',
      tFresh?.stopFeeMWK === 0, `stopFeeMWK=${tFresh?.stopFeeMWK}`);
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`   PACKAGE 1 SUITE: ${passed}/${total} TESTS PASSED`);
  if (passed < total) console.log(`   ⚠️  ${total - passed} FAILURES`);
  console.log('=============================================================\n');

  return { passed, total, failed: total - passed };
}

if (require.main === module) {
  runPkg1Suite()
    .then(s => { server.close(); process.exit(s.failed > 0 ? 1 : 0); })
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
}

module.exports = { runPkg1Suite };

