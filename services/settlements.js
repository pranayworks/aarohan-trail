// ============================================================================
// Aarohan commission remittances (cash-trip commission paid by drivers)
// ----------------------------------------------------------------------------
// Stored in PostgreSQL (CommissionRemittance). Approval claims the request and
// writes the balanced ledger journal in ONE database transaction, so a crash
// can never leave a verified remittance without a journal.
// ============================================================================

const prisma = require('../lib/prisma');
const dbLedger = require('./dbLedger');

class SettlementError extends Error {
  constructor(message, statusCode = 400, code = 'SETTLEMENT_ERROR') {
    super(message);
    this.name = 'SettlementError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeMethod(method) {
  const key = String(method || 'AIRTEL_MONEY').toUpperCase().replace(/[\s-]/g, '_');
  if (key.includes('AIRTEL')) return 'AIRTEL_MONEY';
  if (key.includes('TNM') || key.includes('MPAMBA')) return 'TNM_MPAMBA';
  if (key.includes('BANK')) return 'BANK_TRANSFER';
  throw new SettlementError(`Unsupported remittance method "${method}"`, 400, 'INVALID_METHOD');
}

function toApi(r) {
  if (!r) return null;
  return {
    settlementId: r.id,
    driverId: r.driverId,
    amount: r.amountMWK,
    remittanceMethod: r.method,
    remittanceReference: r.reference,
    notes: r.notes || null,
    status: r.status,
    submittedAt: r.submittedAt,
    reviewedBy: r.reviewedBy || null,
    reviewedAt: r.reviewedAt || null,
    reviewNotes: r.reviewNotes || null,
    journalId: r.journalId || null
  };
}

async function submit({ driverId, amountMWK, method, reference, notes }) {
  const amount = Number(amountMWK);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new SettlementError('Valid settlement amount required (must be > 0)', 400, 'INVALID_AMOUNT');
  }
  const ref = String(reference || '').trim();
  if (ref.length < 4 || ref.length > 64) {
    throw new SettlementError('Mobile money reference required (4 to 64 characters)', 400, 'INVALID_REFERENCE');
  }
  const normalizedMethod = normalizeMethod(method);

  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new SettlementError('Driver not found', 404, 'DRIVER_NOT_FOUND');

  const pending = await prisma.commissionRemittance.aggregate({
    where: { driverId, status: 'PENDING_VERIFICATION' },
    _sum: { amountMWK: true }
  });
  const available = driver.commissionDebtMWK - (pending._sum.amountMWK || 0);
  if (amount > available) {
    throw new SettlementError(
      `Amount exceeds the outstanding commission (MK ${Math.max(0, available)} available to settle)`,
      400,
      'EXCEEDS_DEBT'
    );
  }

  try {
    const created = await prisma.commissionRemittance.create({
      data: {
        driverId,
        amountMWK: amount,
        method: normalizedMethod,
        reference: ref,
        notes: notes ? String(notes).slice(0, 500) : null
      }
    });
    return toApi(created);
  } catch (err) {
    if (err && (err.code === 'P2002' || /unique/i.test(err.message || ''))) {
      throw new SettlementError('This payment reference has already been submitted', 409, 'DUPLICATE_REFERENCE');
    }
    throw err;
  }
}

async function listPending() {
  const rows = await prisma.commissionRemittance.findMany({
    where: { status: 'PENDING_VERIFICATION' },
    orderBy: { submittedAt: 'asc' },
    take: 200,
    include: {
      driver: {
        include: {
          user: { select: { name: true, phone: true } },
          vehicle: true
        }
      }
    }
  });
  return rows.map((r) => ({
    ...toApi(r),
    driverName: r.driver?.user?.name || 'Driver Partner',
    driverPhone: r.driver?.user?.phone || 'N/A',
    currentDebtMWK: r.driver?.commissionDebtMWK ?? r.amountMWK,
    plateNumber: r.driver?.vehicle?.plateNumber || 'N/A',
    realDriverId: r.driverId
  }));
}

async function approve({ settlementId, adminUserId, notes }) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.commissionRemittance.updateMany({
      where: { id: settlementId, status: 'PENDING_VERIFICATION' },
      data: {
        status: 'VERIFIED',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reviewNotes: notes || null
      }
    });

    if (claimed.count === 0) {
      const existing = await tx.commissionRemittance.findUnique({ where: { id: settlementId } });
      if (!existing) throw new SettlementError(`Settlement ${settlementId} not found`, 404, 'NOT_FOUND');
      throw new SettlementError(
        `Settlement is already ${existing.status.toLowerCase().replace(/_/g, ' ')}`,
        400,
        'ALREADY_PROCESSED'
      );
    }

    const remittance = await tx.commissionRemittance.findUnique({ where: { id: settlementId } });
    const ledgerResult = await dbLedger.recordCommissionSettlement({
      driverId: remittance.driverId,
      amountMWK: remittance.amountMWK,
      reference: remittance.reference,
      settlementId: remittance.id,
      verifiedByUserId: adminUserId,
      notes: notes || 'Admin verified commission remittance',
      tx
    });

    const updated = await tx.commissionRemittance.update({
      where: { id: remittance.id },
      data: { journalId: ledgerResult.journalId }
    });

    return { remittance: toApi(updated), ledgerResult };
  }, { maxWait: 10000, timeout: 30000 });
}

async function reject({ settlementId, adminUserId, reason, ipAddress = null, userAgent = null }) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new SettlementError('Rejection reason is required', 400, 'REASON_REQUIRED');

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.commissionRemittance.updateMany({
      where: { id: settlementId, status: 'PENDING_VERIFICATION' },
      data: {
        status: 'REJECTED',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reviewNotes: cleanReason
      }
    });

    if (claimed.count === 0) {
      const existing = await tx.commissionRemittance.findUnique({ where: { id: settlementId } });
      if (!existing) throw new SettlementError(`Settlement ${settlementId} not found`, 404, 'NOT_FOUND');
      throw new SettlementError(
        existing.status === 'VERIFIED'
          ? 'Cannot reject an already verified settlement'
          : 'Settlement was already rejected',
        400,
        'ALREADY_PROCESSED'
      );
    }

    const remittance = await tx.commissionRemittance.findUnique({ where: { id: settlementId } });
    await tx.auditLog.create({
      data: {
        userId: adminUserId,
        action: 'MANUAL_ADJUSTMENT',
        entityType: 'COMMISSION_SETTLEMENT',
        entityId: settlementId,
        details: {
          settlementId,
          decision: 'REJECTED',
          reason: cleanReason,
          driverId: remittance.driverId,
          amountMWK: remittance.amountMWK
        },
        ipAddress,
        userAgent
      }
    });
    return toApi(remittance);
  });
}

module.exports = { SettlementError, normalizeMethod, toApi, submit, listPending, approve, reject };
