// ============================================================================
// AAROHAN TRIP RECORD CSV EXPORT SERVICE & CLI • PRODUCTION READINESS
// ============================================================================
// Exports complete trip legal/safety records to CSV for a specified date range.
// Administrative tool with mandatory immutable AuditLog emission.
// NO deletion code.
// ============================================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function exportTripRecords({ from, to, outputPath, adminActor = null }) {
  console.log('=============================================================');
  console.log('   AAROHAN TRIP RECORD EXPORT SERVICE');
  console.log('   Lilongwe, Malawi • Legal & Financial Audit Extraction');
  console.log('=============================================================\n');

  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error('Invalid date parameters. Must be ISO strings or YYYY-MM-DD.');
  }

  console.log(`⏳ Querying trip records between ${fromDate.toISOString()} and ${toDate.toISOString()}...`);

  const trips = await prisma.trip.findMany({
    where: {
      createdAt: {
        gte: fromDate,
        lte: toDate
      }
    },
    include: {
      rider: true,
      driver: {
        include: {
          user: true,
          vehicle: true
        }
      },
      stops: {
        orderBy: { sequence: 'asc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`   Found ${trips.length} trip record(s) in database.`);

  const headers = [
    'Trip ID',
    'Service Type',
    'Status',
    'Created At',
    'Completed At',
    'Rider Name',
    'Rider Phone',
    'Driver Name',
    'Driver Phone',
    'Vehicle Plate',
    'Vehicle Type',
    'Gross Fare (MWK)',
    'Base Fare (MWK)',
    'Booking Fee (MWK)',
    'Stop Fee (MWK)',
    'Stop Count',
    'Platform Commission (MWK)',
    'Driver Share (MWK)',
    'Payment Method',
    'Payment Status',
    'Pickup Address',
    'Pickup Lat',
    'Pickup Lng',
    'Dropoff Address',
    'Dropoff Lat',
    'Dropoff Lng',
    'Stops Summary',
    'Cancelled By',
    'Cancel Reason'
  ];

  const csvRows = [headers.map(escapeCsvCell).join(',')];

  for (const t of trips) {
    const stopsSummary = (t.stops || [])
      .map(s => `[Stop ${s.sequence}: ${s.address || 'Coord'} (${s.lat},${s.lng})]`)
      .join(' | ');

    const row = [
      t.id,
      t.serviceType || 'RIDE',
      t.status,
      t.createdAt ? t.createdAt.toISOString() : '',
      t.completedAt ? t.completedAt.toISOString() : '',
      t.rider?.name || '',
      t.rider?.phone || '',
      t.driver?.user?.name || '',
      t.driver?.user?.phone || '',
      t.driver?.vehicle?.plateNumber || '',
      t.driver?.vehicle?.type || '',
      t.fareMWK ?? 0,
      t.baseFareMWK ?? 0,
      t.bookingFeeMWK ?? 0,
      t.stopFeeMWK ?? 0,
      t.stopCount ?? 0,
      t.commissionMWK ?? 0,
      t.driverShareMWK ?? 0,
      t.paymentMethod || 'CASH',
      t.paymentStatus || 'PENDING',
      t.pickupAddress || '',
      t.pickupLat ?? '',
      t.pickupLng ?? '',
      t.dropoffAddress || '',
      t.dropoffLat ?? '',
      t.dropoffLng ?? '',
      stopsSummary,
      t.cancelledBy || '',
      t.cancelReason || ''
    ];

    csvRows.push(row.map(escapeCsvCell).join(','));
  }

  const defaultFile = `trips_export_${fromDate.toISOString().slice(0, 10)}_to_${toDate.toISOString().slice(0, 10)}.csv`;
  const resolvedPath = path.resolve(outputPath || path.join(__dirname, '..', 'exports', defaultFile));

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(resolvedPath, csvRows.join('\r\n'), 'utf8');
  console.log(`✅ CSV exported successfully to: ${resolvedPath}`);

  // Emit AuditLog
  let actorId = adminActor?.id || null;
  if (!actorId) {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    actorId = admin ? admin.id : null;
  }

  if (actorId) {
    await prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'ADMIN_TRIP_RECORD_VIEWED',
        entityType: 'TRIP_EXPORT',
        entityId: path.basename(resolvedPath),
        details: {
          exportType: 'CSV',
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          rowCount: trips.length,
          outputFile: path.basename(resolvedPath),
          exportedAt: new Date().toISOString()
        }
      }
    });
    console.log(`✅ Immutable AuditLog written for actor: ${actorId}`);
  }

  return {
    filePath: resolvedPath,
    count: trips.length
  };
}

// CLI Argument Parser
if (require.main === module) {
  const args = process.argv.slice(2);
  let from = null;
  let to = null;
  let out = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) from = args[++i];
    else if (args[i] === '--to' && args[i + 1]) to = args[++i];
    else if (args[i] === '--output' && args[i + 1]) out = args[++i];
  }

  exportTripRecords({ from, to, outputPath: out })
    .then((res) => {
      console.log(`\nExport complete: ${res.count} records written to ${res.filePath}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Export failed:', err.message);
      process.exit(1);
    });
}

module.exports = { exportTripRecords };

