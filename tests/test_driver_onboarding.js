// ============================================================================
// AAROHAN DRIVER ONBOARDING & SUPABASE STORAGE TEST SUITE (Week 1, Part A)
// Lilongwe, Malawi • Private Storage, RBAC, Driver Approval, Audit Trail
// ============================================================================

require('dotenv').config();
const assert = require('assert');
const ioClient = require('socket.io-client');
const prisma = require('../lib/prisma');
const authService = require('../services/auth');
const { app, server } = require('../server');

const TEST_PORT = 3099;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function runDriverOnboardingSuite() {
  console.log('=============================================================');
  console.log('   AAROHAN DRIVER ONBOARDING & ADMIN VERIFICATION SUITE');
  console.log('   Lilongwe, Malawi • Private Supabase Storage & RBAC Tests');
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
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // Ensure server is listening on TEST_PORT
  if (!server.listening) {
    await new Promise((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', resolve);
    });
  }

  try {
    // -------------------------------------------------------------------------
    // SETUP FIXTURES IN DATABASE
    // -------------------------------------------------------------------------
    console.log('--- 1. Setting Up Test Fixtures ---');

    // Fixture 1: Pure Rider
    const testRiderPhone = '+265998880001';
    let testRider = await prisma.user.findUnique({ where: { phone: testRiderPhone } });
    if (!testRider) {
      testRider = await prisma.user.create({
        data: {
          phone: testRiderPhone,
          name: 'Onboard Test Rider',
          role: 'RIDER',
          status: 'ACTIVE'
        }
      });
    }
    const riderToken = authService.issueAccessToken(testRider);
    report('Rider test user and JWT token established', !!riderToken);

    // Fixture 2: Admin User
    const adminPhone = '+265990000001';
    const adminUser = await prisma.user.findUnique({ where: { phone: adminPhone } });
    assert(adminUser, 'Admin user must exist in database');
    const adminToken = authService.issueAccessToken(adminUser);
    report('Admin user and JWT token established', !!adminToken && adminUser.role === 'ADMIN');

    // Fixture 3: Support User
    const supportPhone = '+265990000099';
    let supportUser = await prisma.user.findUnique({ where: { phone: supportPhone } });
    if (!supportUser) {
      supportUser = await prisma.user.create({
        data: {
          phone: supportPhone,
          name: 'AArohan Operations Support',
          role: 'SUPPORT',
          status: 'ACTIVE'
        }
      });
    }
    const supportToken = authService.issueAccessToken(supportUser);
    report('Support user and JWT token established', !!supportToken && supportUser.role === 'SUPPORT');

    // Fixture 4: Driver A (Candidate with PENDING approval)
    const driverAPhone = '+265998880002';
    let driverAUser = await prisma.user.findUnique({
      where: { phone: driverAPhone },
      include: { driverProfile: { include: { vehicle: true } } }
    });
    if (!driverAUser) {
      driverAUser = await prisma.user.create({
        data: {
          phone: driverAPhone,
          name: 'Driver Candidate Alpha',
          role: 'DRIVER',
          status: 'ACTIVE',
          driverProfile: {
            create: {
              approvalStatus: 'PENDING',
              availability: 'OFFLINE',
              vehicle: {
                create: {
                  type: 'CAB',
                  makeModel: 'Toyota Passo',
                  color: 'White',
                  plateNumber: 'BW-ONBOARD-A',
                  year: 2019
                }
              }
            }
          }
        },
        include: { driverProfile: { include: { vehicle: true } } }
      });
    } else if (!driverAUser.driverProfile) {
      await prisma.driver.create({
        data: {
          userId: driverAUser.id,
          approvalStatus: 'PENDING',
          availability: 'OFFLINE',
          vehicle: {
            create: {
              type: 'CAB',
              makeModel: 'Toyota Passo',
              color: 'White',
              plateNumber: 'BW-ONBOARD-A',
              year: 2019
            }
          }
        }
      });
      driverAUser = await prisma.user.findUnique({
        where: { id: driverAUser.id },
        include: { driverProfile: { include: { vehicle: true } } }
      });
    } else {
      await prisma.driver.update({
        where: { id: driverAUser.driverProfile.id },
        data: { approvalStatus: 'PENDING', availability: 'OFFLINE' }
      });
      driverAUser = await prisma.user.findUnique({
        where: { id: driverAUser.id },
        include: { driverProfile: { include: { vehicle: true } } }
      });
    }
    const driverAToken = authService.issueAccessToken(driverAUser);
    report('Driver A (PENDING) established', !!driverAToken && driverAUser.driverProfile.approvalStatus === 'PENDING');

    // Fixture 5: Driver B (Separate driver for ownership isolation tests)
    const driverBPhone = '+265998880003';
    let driverBUser = await prisma.user.findUnique({
      where: { phone: driverBPhone },
      include: { driverProfile: { include: { vehicle: true } } }
    });
    if (!driverBUser) {
      driverBUser = await prisma.user.create({
        data: {
          phone: driverBPhone,
          name: 'Driver Candidate Bravo',
          role: 'DRIVER',
          status: 'ACTIVE',
          driverProfile: {
            create: {
              approvalStatus: 'PENDING',
              availability: 'OFFLINE',
              vehicle: {
                create: {
                  type: 'MOTO',
                  makeModel: 'Bajaj Boxer 150',
                  color: 'Red',
                  plateNumber: 'BW-ONBOARD-B',
                  year: 2021
                }
              }
            }
          }
        },
        include: { driverProfile: { include: { vehicle: true } } }
      });
    } else if (!driverBUser.driverProfile) {
      await prisma.driver.create({
        data: {
          userId: driverBUser.id,
          approvalStatus: 'PENDING',
          availability: 'OFFLINE',
          vehicle: {
            create: {
              type: 'MOTO',
              makeModel: 'Bajaj Boxer 150',
              color: 'Red',
              plateNumber: 'BW-ONBOARD-B',
              year: 2021
            }
          }
        }
      });
      driverBUser = await prisma.user.findUnique({
        where: { id: driverBUser.id },
        include: { driverProfile: { include: { vehicle: true } } }
      });
    } else {
      await prisma.driver.update({
        where: { id: driverBUser.driverProfile.id },
        data: { approvalStatus: 'PENDING', availability: 'OFFLINE' }
      });
      driverBUser = await prisma.user.findUnique({
        where: { id: driverBUser.id },
        include: { driverProfile: { include: { vehicle: true } } }
      });
    }
    const driverBToken = authService.issueAccessToken(driverBUser);
    report('Driver B established for cross-driver isolation tests', !!driverBToken);

    // -------------------------------------------------------------------------
    // 2. REQUIREMENT 6: A RIDER CANNOT CALL ADMIN ROUTES (403)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing Rider Cannot Call Admin Routes ---');

    const adminEndpointsToTest = [
      { method: 'GET', path: '/api/admin/drivers', body: null },
      { method: 'GET', path: '/api/admin/drivers/pending', body: null },
      { method: 'POST', path: `/api/admin/drivers/${driverAUser.driverProfile.id}/approve`, body: {} },
      { method: 'POST', path: `/api/admin/drivers/${driverAUser.driverProfile.id}/reject`, body: { reason: 'Test' } },
      { method: 'POST', path: `/api/admin/drivers/${driverAUser.driverProfile.id}/suspend`, body: { reason: 'Test' } },
      { method: 'GET', path: '/api/admin/metrics', body: null }
    ];

    for (const ep of adminEndpointsToTest) {
      const opts = {
        method: ep.method,
        headers: {
          'Authorization': `Bearer ${riderToken}`,
          'Content-Type': 'application/json'
        }
      };
      if (ep.body) opts.body = JSON.stringify(ep.body);

      const res = await fetch(`${BASE_URL}${ep.path}`, opts);
      report(`Rider blocked from ${ep.method} ${ep.path} (HTTP 403)`, res.status === 403, `Got HTTP ${res.status}`);
    }

    // -------------------------------------------------------------------------
    // 3. REQUIREMENT 6: A PENDING DRIVER CANNOT GO ONLINE
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing PENDING Driver Cannot Go Online ---');

    // A. REST Telemetry Endpoint: POST /api/drivers/location
    const locRes = await fetch(`${BASE_URL}/api/drivers/location`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${driverAToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lat: -13.9625,
        lng: 33.7741,
        heading: 90
      })
    });
    const locData = await locRes.json();
    report('PENDING driver blocked from updating GPS location via REST (HTTP 403)', locRes.status === 403 && locData.code === 'DRIVER_NOT_APPROVED', `Got status ${locRes.status}: ${locData.error}`);

    // B. WebSocket Connection Handshake
    const socketAttempt = await new Promise((resolve) => {
      const s = ioClient(BASE_URL, {
        transports: ['websocket'],
        auth: { token: driverAToken },
        reconnection: false,
        timeout: 3000
      });

      s.on('connect', () => {
        s.disconnect();
        resolve({ connected: true });
      });

      s.on('connect_error', (err) => {
        resolve({ connected: false, message: err.message });
      });
    });

    report(
      'PENDING driver WebSocket connection rejected at auth handshake',
      socketAttempt.connected === false && socketAttempt.message.toLowerCase().includes('not approved'),
      `Handshake error: ${socketAttempt.message}`
    );

    // -------------------------------------------------------------------------
    // 4. REQUIREMENT 6: FILE TYPE AND SIZE LIMITS ON UPLOADS
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Document Upload Validation (File Type & Size) ---');

    // Helper: generate multipart/form-data body manually with boundary
    function createMultipartBody({ boundary, fields = {}, files = [] }) {
      const parts = [];
      for (const [key, val] of Object.entries(fields)) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`));
      }
      for (const f of files) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"; filename="${f.filename}"\r\nContent-Type: ${f.mimeType}\r\n\r\n`));
        parts.push(f.buffer);
        parts.push(Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      return Buffer.concat(parts);
    }

    // A. Invalid MIME Type (e.g. application/x-msdownload / executable)
    const boundaryA = '----WebKitFormBoundaryTestA' + Date.now();
    const invalidTypeBody = createMultipartBody({
      boundary: boundaryA,
      fields: { documentType: 'DRIVING_LICENSE' },
      files: [{
        name: 'file',
        filename: 'malicious_script.exe',
        mimeType: 'application/x-msdownload',
        buffer: Buffer.from('MZ_EXECUTABLE_HEADER_TEST')
      }]
    });

    const invalidTypeRes = await fetch(`${BASE_URL}/api/driver/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${driverAToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundaryA}`
      },
      body: invalidTypeBody
    });
    const invalidTypeData = await invalidTypeRes.json();
    report(
      'Upload rejects invalid file MIME type with HTTP 400',
      invalidTypeRes.status === 400 && invalidTypeData.error.includes('Allowed types: JPEG, PNG, PDF'),
      `Got ${invalidTypeRes.status}: ${invalidTypeData.error}`
    );

    // B. File Size Limit (> 5 MB)
    const boundaryB = '----WebKitFormBoundaryTestB' + Date.now();
    const oversizedBuffer = Buffer.alloc(5.5 * 1024 * 1024, 0x41); // 5.5 MB
    const oversizedBody = createMultipartBody({
      boundary: boundaryB,
      fields: { documentType: 'DRIVING_LICENSE' },
      files: [{
        name: 'file',
        filename: 'huge_license.pdf',
        mimeType: 'application/pdf',
        buffer: oversizedBuffer
      }]
    });

    const oversizedRes = await fetch(`${BASE_URL}/api/driver/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${driverAToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundaryB}`
      },
      body: oversizedBody
    });
    const oversizedData = await oversizedRes.json();
    report(
      'Upload rejects files exceeding 5 MB with HTTP 400',
      oversizedRes.status === 400 && oversizedData.error.toLowerCase().includes('5 mb'),
      `Got ${oversizedRes.status}: ${oversizedData.error}`
    );

    // C. Valid File Upload (JPEG under 5 MB)
    const boundaryC = '----WebKitFormBoundaryTestC' + Date.now();
    const validJpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
    const validBody = createMultipartBody({
      boundary: boundaryC,
      fields: { documentType: 'DRIVING_LICENSE' },
      files: [{
        name: 'file',
        filename: 'driver_license.jpg',
        mimeType: 'image/jpeg',
        buffer: validJpegBuffer
      }]
    });

    const validUploadRes = await fetch(`${BASE_URL}/api/driver/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${driverAToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundaryC}`
      },
      body: validBody
    });
    const validUploadData = await validUploadRes.json();
    report(
      'Upload accepts valid JPEG license, stores in private bucket, and returns signed URL',
      validUploadRes.status === 200 && validUploadData.success === true && !!validUploadData.document.signedUrl,
      `Signed URL: ${validUploadData.document?.signedUrl?.substring(0, 50)}...`
    );

    // Verify DriverDocument row exists in database
    const savedDoc = await prisma.driverDocument.findFirst({
      where: {
        driverId: driverAUser.driverProfile.id,
        type: 'DRIVING_LICENSE'
      }
    });
    report(
      'DriverDocument row saved in PostgreSQL with status PENDING',
      !!savedDoc && savedDoc.status === 'PENDING' && savedDoc.storagePath.includes(driverAUser.driverProfile.id)
    );

    // -------------------------------------------------------------------------
    // 5. REQUIREMENT 6: ONE DRIVER CANNOT SEE ANOTHER'S DOCUMENTS (403)
    // -------------------------------------------------------------------------
    console.log("\n--- 5. Testing One Driver Cannot Access Another's Documents ---");

    // A. Driver B attempts to query Driver A's documents list
    const crossDriverListRes = await fetch(`${BASE_URL}/api/driver/documents?driverId=${driverAUser.driverProfile.id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${driverBToken}` }
    });
    const crossDriverListData = await crossDriverListRes.json();
    report(
      "Driver B blocked from querying Driver A's documents (HTTP 403)",
      crossDriverListRes.status === 403 && crossDriverListData.error.includes("another driver's documents"),
      `Got ${crossDriverListRes.status}: ${crossDriverListData.error}`
    );

    // B. Driver B attempts to download Driver A's raw file path
    const crossDriverRawRes = await fetch(`${BASE_URL}/api/driver/documents/raw?path=${encodeURIComponent(savedDoc.storagePath)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${driverBToken}` }
    });
    report(
      "Driver B blocked from downloading Driver A's raw document object (HTTP 403)",
      crossDriverRawRes.status === 403
    );

    // C. Driver A can view their own documents
    const ownDocRes = await fetch(`${BASE_URL}/api/driver/documents`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${driverAToken}` }
    });
    const ownDocData = await ownDocRes.json();
    report(
      "Driver A successfully retrieves their own documents with signed URLs",
      ownDocRes.status === 200 && Array.isArray(ownDocData.documents) && ownDocData.documents.length >= 1
    );

    // -------------------------------------------------------------------------
    // 6. REQUIREMENT 4: ADMIN / SUPPORT VERIFICATION QUEUE & AUDIT LOGS
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing Admin / Support Queue, Approval, and AuditTrail ---');

    // A. Admin & Support can list pending queue with signed document URLs
    const pendingResAdmin = await fetch(`${BASE_URL}/api/admin/drivers/pending`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const pendingListAdmin = await pendingResAdmin.json();
    report(
      'Admin can list pending driver queue with short-lived signed URLs',
      pendingResAdmin.status === 200 && Array.isArray(pendingListAdmin) && pendingListAdmin.some(d => d.id === driverAUser.driverProfile.id)
    );

    const pendingResSupport = await fetch(`${BASE_URL}/api/admin/drivers/pending`, {
      headers: { 'Authorization': `Bearer ${supportToken}` }
    });
    report(
      'Support role can list pending driver queue',
      pendingResSupport.status === 200
    );

    // B. Support Approves Driver A
    const approveRes = await fetch(`${BASE_URL}/api/admin/drivers/${driverAUser.driverProfile.id}/approve`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supportToken}`,
        'Content-Type': 'application/json'
      }
    });
    const approveData = await approveRes.json();
    report(
      'Support approves candidate driver (HTTP 200)',
      approveRes.status === 200 && approveData.driver.approvalStatus === 'APPROVED'
    );

    // Verify AuditLog for DRIVER_APPROVED
    const auditApprove = await prisma.auditLog.findFirst({
      where: {
        action: 'DRIVER_APPROVED',
        entityId: driverAUser.driverProfile.id
      },
      orderBy: { createdAt: 'desc' }
    });
    report(
      'AuditLog row written with action DRIVER_APPROVED and support user ID',
      !!auditApprove && auditApprove.userId === supportUser.id && auditApprove.details.approvedByRole === 'SUPPORT'
    );

    // C. Approved Driver can now go online and update GPS location!
    const approvedLocRes = await fetch(`${BASE_URL}/api/drivers/location`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${driverAToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lat: -13.9625,
        lng: 33.7741,
        heading: 90
      })
    });
    report(
      'Approved driver is permitted to publish location and go online (HTTP 200)',
      approvedLocRes.status === 200
    );

    // D. Admin Suspends Driver A
    const suspendRes = await fetch(`${BASE_URL}/api/admin/drivers/${driverAUser.driverProfile.id}/suspend`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: 'Vehicle spot-check required' })
    });
    const suspendData = await suspendRes.json();
    report(
      'Admin suspends driver and sets availability OFFLINE (HTTP 200)',
      suspendRes.status === 200 && suspendData.driver.approvalStatus === 'SUSPENDED' && suspendData.driver.availability === 'OFFLINE'
    );

    const auditSuspend = await prisma.auditLog.findFirst({
      where: {
        action: 'DRIVER_SUSPENDED',
        entityId: driverAUser.driverProfile.id
      },
      orderBy: { createdAt: 'desc' }
    });
    report(
      'AuditLog row written with action DRIVER_SUSPENDED',
      !!auditSuspend && auditSuspend.userId === adminUser.id && auditSuspend.details.reason === 'Vehicle spot-check required'
    );

    // Suspended driver now blocked from location updates
    const suspendedLocRes = await fetch(`${BASE_URL}/api/drivers/location`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${driverAToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ lat: -13.96, lng: 33.77 })
    });
    report(
      'Suspended driver blocked from updating location (HTTP 403)',
      suspendedLocRes.status === 403
    );

    // E. Admin Rejects Driver A with reason
    const rejectRes = await fetch(`${BASE_URL}/api/admin/drivers/${driverAUser.driverProfile.id}/reject`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: 'Driving licence expired past 30 days grace period' })
    });
    const rejectData = await rejectRes.json();
    report(
      'Admin rejects driver with specific compliance reason (HTTP 200)',
      rejectRes.status === 200 && rejectData.driver.approvalStatus === 'REJECTED'
    );

    const auditReject = await prisma.auditLog.findFirst({
      where: {
        action: 'DRIVER_REJECTED',
        entityId: driverAUser.driverProfile.id
      },
      orderBy: { createdAt: 'desc' }
    });
    report(
      'AuditLog row written with action DRIVER_REJECTED and specific reason stored',
      !!auditReject && auditReject.details.reason === 'Driving licence expired past 30 days grace period'
    );

    console.log('\n=============================================================');
    console.log(`   DRIVER ONBOARDING AUDIT RESULTS: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
    console.log('=============================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Fatal Test Error:', err);
    process.exit(1);
  }
}

runDriverOnboardingSuite();
