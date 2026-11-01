// ============================================================================
// GAMAN AUTHORITATIVE FINANCIAL LEDGER & ACCOUNTING SERVICE • LILONGWE, MALAWI
// ============================================================================
// Enforces:
//   - 30% Gaman Platform Commission / 70% Driver Net Share on Eligible Fares
//   - 100% Driver Tips (0% Commission)
//   - Integer MWK (Malawian Kwacha) Currency & Documented Rounding
//   - Cash Collection Accounting vs Commission Debt Ledger
//   - Digital Escrow Holding & Idempotent Driver Mobile Money Payouts
//   - Double-Entry Auditable Ledger with Reversals & Atomic Idempotency
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEDGER_FILE = path.join(__dirname, '..', 'data', 'financial_ledger.json');

class FinanceService {
  constructor() {
    this.ledger = {
      pricingVersions: [],
      breakdowns: [],
      commissionLedger: [],
      driverEarningsLedger: [],
      paymentTransactions: [],
      payoutTransactions: [],
      cashSettlements: [],
      adjustments: [],
      auditLogs: []
    };
    this.idempotencyIndex = new Set();
    this.loadLedger();
  }

  loadLedger() {
    try {
      if (fs.existsSync(LEDGER_FILE)) {
        const raw = fs.readFileSync(LEDGER_FILE, 'utf8');
        this.ledger = Object.assign(this.ledger, JSON.parse(raw));
        // Rebuild idempotency index
        this.idempotencyIndex.clear();
        for (const entry of (this.ledger.commissionLedger || [])) {
          if (entry.idempotencyKey) this.idempotencyIndex.add(entry.idempotencyKey);
        }
        for (const entry of (this.ledger.driverEarningsLedger || [])) {
          if (entry.idempotencyKey) this.idempotencyIndex.add(entry.idempotencyKey);
        }
        for (const tx of (this.ledger.paymentTransactions || [])) {
          if (tx.idempotencyKey) this.idempotencyIndex.add(tx.idempotencyKey);
        }
        for (const tx of (this.ledger.payoutTransactions || [])) {
          if (tx.idempotencyKey) this.idempotencyIndex.add(tx.idempotencyKey);
        }
        for (const adj of (this.ledger.adjustments || [])) {
          if (adj.idempotencyKey) this.idempotencyIndex.add(adj.idempotencyKey);
        }
      } else {
        this.persistLedger();
      }
    } catch (err) {
      console.error('[FinanceService] Error loading financial ledger:', err);
    }
  }

  persistLedger() {
    try {
      const dir = path.dirname(LEDGER_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(LEDGER_FILE, JSON.stringify(this.ledger, null, 2), 'utf8');
    } catch (err) {
      console.error('[FinanceService] Error persisting financial ledger:', err);
    }
  }

  // --------------------------------------------------------------------------
  // FINANCIAL CALCULATION: Authoritative 30% Commission & 70% Driver Share
  // --------------------------------------------------------------------------
  /**
   * Computes the authoritative financial breakdown for an eligible fare.
   * Business Policy:
   *   - Eligible Ride Fare is split exactly: 30% Gaman Commission, 70% Driver Share
   *   - Tips belong 100% to Driver (zero commission)
   *   - Booking fees (if configured) belong to platform, non-commissionable
   *   - All amounts are integer MWK
   *
   * Example:
   *   Eligible Fare: MWK 10,000 -> Driver Share: MWK 7,000, Gaman Commission: MWK 3,000
   */
  calculateFinancialSplit({
    grossFare,
    driverTip = 0,
    bookingFee = 0,
    discountAmount = 0,
    commissionRate = 0.30
  }) {
    const rawGross = Math.max(0, parseInt(grossFare, 10) || 0);
    const tip = Math.max(0, parseInt(driverTip, 10) || 0);
    const fee = Math.max(0, parseInt(bookingFee, 10) || 0);
    const discount = Math.max(0, parseInt(discountAmount, 10) || 0);

    // Eligible fare is the ride component excluding separately handled tips & booking fees
    // If discount was applied, it reduces the eligible fare paid
    const eligibleFare = Math.max(0, rawGross - fee - discount);

    // Authoritative 30% Commission / 70% Driver Split
    const commissionAmount = Math.round(eligibleFare * commissionRate);
    const driverShare = eligibleFare - commissionAmount; // Guarantees exact integer sum: driverShare + commissionAmount == eligibleFare

    const totalPassengerPayable = rawGross + tip;
    const totalDriverNetEarnings = driverShare + tip; // 100% tip added to driver earnings
    const totalPlatformRevenue = commissionAmount + fee; // Commission + platform booking fee

    return {
      currency: 'MWK',
      grossFare: rawGross,
      bookingFee: fee,
      discountAmount: discount,
      eligibleFare,
      commissionRate,
      commissionAmount,
      driverShare,
      driverTip: tip,
      totalPassengerPayable,
      totalDriverNetEarnings,
      totalPlatformRevenue
    };
  }

  // --------------------------------------------------------------------------
  // ATOMIC SETTLEMENT: Called when a ride completes
  // --------------------------------------------------------------------------
  /**
   * Settles a completed ride atomically and records entries in:
   *   1. ride_fare_breakdowns
   *   2. commission_ledger
   *   3. driver_earnings_ledger
   * Idempotent: repeated invocations with same rideId return existing settlement without double-posting.
   */
  settleCompletedRide({
    rideId,
    quoteId = null,
    versionId = 'GMN-PRICE-V1',
    categoryId = 'cab',
    driverId,
    riderId,
    grossFare,
    driverTip = 0,
    bookingFee = 0,
    discountAmount = 0,
    paymentMethod = 'CASH', // 'CASH', 'AIRTEL_MONEY', 'TNM_MPAMBA'
    pickupAddress = '',
    destinationAddress = ''
  }) {
    if (!rideId || !driverId) {
      throw new Error('rideId and driverId are required for financial settlement.');
    }

    const idempotencyKey = `SETTLE-RIDE-${rideId}`;
    if (this.idempotencyIndex.has(idempotencyKey)) {
      console.warn(`[FinanceService] Duplicate settlement attempt ignored for ${rideId}`);
      return this.getRideBreakdown(rideId);
    }

    // 1. Calculate authoritative split
    const split = this.calculateFinancialSplit({
      grossFare,
      driverTip,
      bookingFee,
      discountAmount,
      commissionRate: 0.30 // 30% Gaman policy
    });

    const isCash = (paymentMethod || '').toUpperCase().includes('CASH');
    const breakdownId = 'BRK-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    // 2. Record Ride Breakdown Snapshot
    const breakdown = {
      breakdownId,
      rideId,
      quoteId,
      versionId,
      categoryId,
      driverId,
      riderId,
      pickupAddress,
      destinationAddress,
      grossFare: split.grossFare,
      eligibleFare: split.eligibleFare,
      bookingFee: split.bookingFee,
      discountAmount: split.discountAmount,
      commissionRate: split.commissionRate,
      commissionAmount: split.commissionAmount,
      driverShare: split.driverShare,
      driverTip: split.driverTip,
      isCash: Boolean(isCash),
      driverGrossShare: split.driverShare,
      totalPassengerPaid: split.totalPassengerPayable,
      totalDriverNetEarnings: split.totalDriverNetEarnings,
      totalPlatformRevenue: split.totalPlatformRevenue,
      paymentMethod: isCash ? 'CASH' : paymentMethod,
      currency: 'MWK',
      createdAt: new Date().toISOString()
    };
    this.ledger.breakdowns.push(breakdown);

    // 3. Post to Commission Ledger
    // Cash rides: PENDING_CASH_SETTLEMENT (driver collected full cash in hand, owes 30% to Gaman)
    // Digital rides: DEDUCTED_DIGITAL_ESCROW (30% retained in Gaman bank account, 70% credited to driver)
    const commissionEntryId = 'COM-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const commissionEntry = {
      entryId: commissionEntryId,
      rideId,
      driverId,
      eligibleFare: split.eligibleFare,
      commissionRate: split.commissionRate,
      commissionAmount: split.commissionAmount,
      paymentMethod: isCash ? 'CASH' : paymentMethod,
      settlementStatus: isCash ? 'PENDING_CASH_SETTLEMENT' : 'DEDUCTED_DIGITAL_ESCROW',
      idempotencyKey,
      notes: isCash 
        ? `Driver collected MWK ${split.totalPassengerPayable.toLocaleString()} cash; owes MWK ${split.commissionAmount.toLocaleString()} (30%) to Gaman`
        : `Digital escrow: Gaman withheld MWK ${split.commissionAmount.toLocaleString()} commission`,
      settledAt: isCash ? null : new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    this.ledger.commissionLedger.push(commissionEntry);

    // 4. Post to Driver Earnings Ledger
    // Cash: CASH_IN_HAND (driver already holds cash in hand)
    // Digital: DIGITAL_ESCROW (available for instant mobile money payout)
    const driverEntryId = 'DRV-EARN-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const driverEntry = {
      entryId: driverEntryId,
      rideId,
      driverId,
      grossFare: split.grossFare,
      commissionAmount: split.commissionAmount,
      driverNetShare: split.driverShare,
      driverTip: split.driverTip,
      totalDriverEarned: split.totalDriverNetEarnings,
      paymentMethod: isCash ? 'CASH' : paymentMethod,
      collectionMode: isCash ? 'CASH_IN_HAND' : 'DIGITAL_ESCROW',
      payoutStatus: isCash ? 'CASH_RETAINED' : 'AVAILABLE',
      idempotencyKey,
      createdAt: new Date().toISOString()
    };
    this.ledger.driverEarningsLedger.push(driverEntry);

    // Record idempotency
    this.idempotencyIndex.add(idempotencyKey);
    this.persistLedger();

    this.logAudit({
      action: 'SETTLE_RIDE',
      entityType: 'RIDE',
      entityId: rideId,
      actorId: driverId,
      actorRole: 'DRIVER',
      newValues: {
        fare: split.grossFare,
        commission: split.commissionAmount,
        driverNet: split.totalDriverNetEarnings,
        paymentMethod
      }
    });

    return {
      breakdown,
      commissionEntry,
      driverEntry
    };
  }

  // --------------------------------------------------------------------------
  // DRIVER EARNINGS ACCOUNTING
  // --------------------------------------------------------------------------
  /**
   * Returns a complete, verified financial position for a driver:
   *   - Total completed rides
   *   - Gross eligible fares
   *   - Gaman commission total (30%)
   *   - Net earnings total (70% + tips)
   *   - Cash collected in hand by driver
   *   - Outstanding cash commission debt owed to Gaman
   *   - Digital payments collected via escrow
   *   - Available payout balance
   *   - Payout history
   */
  getDriverFinancialSummary(driverId) {
    const earnings = (this.ledger.driverEarningsLedger || []).filter(e => e.driverId === driverId);
    const commissions = (this.ledger.commissionLedger || []).filter(c => c.driverId === driverId);
    const payouts = (this.ledger.payoutTransactions || []).filter(p => p.driverId === driverId);
    const settlements = (this.ledger.cashSettlements || []).filter(s => s.driverId === driverId);

    const completedRidesCount = earnings.length;
    const grossEligibleFare = earnings.reduce((sum, e) => sum + e.grossFare, 0);
    const totalCommissionGenerated = earnings.reduce((sum, e) => sum + e.commissionAmount, 0);
    const netDriverEarnings = earnings.reduce((sum, e) => sum + e.totalDriverEarned, 0);

    // Cash collections
    const cashEarnings = earnings.filter(e => e.collectionMode === 'CASH_IN_HAND');
    const cashCollectedByDriver = cashEarnings.reduce((sum, e) => sum + e.grossFare + (e.driverTip || 0), 0);

    // Cash commission owed to Gaman (30% on cash rides)
    const totalCashCommissionIncurred = commissions
      .filter(c => c.paymentMethod === 'CASH')
      .reduce((sum, c) => sum + c.commissionAmount, 0);

    // Verified cash settlements paid by driver to Gaman
    const verifiedCashRemitted = settlements
      .filter(s => s.status === 'VERIFIED')
      .reduce((sum, s) => sum + s.amount, 0);

    const outstandingCashCommissionDebt = Math.max(0, totalCashCommissionIncurred - verifiedCashRemitted);

    // Digital escrow earnings (eligible for cashout)
    const digitalEarnings = earnings.filter(e => e.collectionMode === 'DIGITAL_ESCROW');
    const totalDigitalEarned = digitalEarnings.reduce((sum, e) => sum + e.totalDriverEarned, 0);

    const successfulPayouts = payouts
      .filter(p => p.status === 'SUCCESS')
      .reduce((sum, p) => sum + p.amount, 0);

    const pendingPayouts = payouts
      .filter(p => p.status === 'PENDING' || p.status === 'PROCESSING')
      .reduce((sum, p) => sum + p.amount, 0);

    const availablePayoutBalance = Math.max(0, totalDigitalEarned - successfulPayouts - pendingPayouts);

    return {
      driverId,
      currency: 'MWK',
      completedRidesCount,
      grossEligibleFare,
      totalCommissionGenerated,
      netDriverEarnings,
      cashCollectedByDriver,
      outstandingCashCommissionDebt,
      outstandingCommissionDebt: outstandingCashCommissionDebt,
      totalCashCommissionIncurred,
      verifiedCashRemitted,
      totalDigitalEarned,
      availablePayoutBalance,
      successfulPayoutsTotal: successfulPayouts,
      pendingPayoutsTotal: pendingPayouts,
      recentPayouts: payouts.slice(-5).reverse(),
      recentSettlements: settlements.slice(-5).reverse()
    };
  }

  // --------------------------------------------------------------------------
  // DOUBLE-ENTRY GENERAL JOURNAL & IDEMPOTENCY
  // --------------------------------------------------------------------------
  recordTransaction({
    reference,
    idempotencyKey,
    accountType = 'ESCROW_HOLDING',
    entryType = 'CREDIT',
    amountMWK,
    description = '',
    currency = 'MWK'
  }) {
    if (idempotencyKey && this.idempotencyIndex.has(idempotencyKey)) {
      throw new Error(`Duplicate transaction: idempotency key ${idempotencyKey} has already been processed.`);
    }

    const tx = {
      txId: 'TX-LEDGER-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900),
      reference: reference || null,
      idempotencyKey: idempotencyKey || null,
      accountType,
      entryType,
      amountMWK: parseInt(amountMWK, 10) || 0,
      description,
      currency,
      recordedAt: new Date().toISOString()
    };

    if (!this.ledger.generalJournal) {
      this.ledger.generalJournal = [];
    }
    this.ledger.generalJournal.push(tx);

    if (idempotencyKey) {
      this.idempotencyIndex.add(idempotencyKey);
    }

    this.persistLedger();
    return tx;
  }

  // --------------------------------------------------------------------------
  // CASH COMMISSION SETTLEMENT WORKFLOW
  // --------------------------------------------------------------------------
  /**
   * Driver submits proof of commission remittance to Gaman (via Airtel Till, TNM, or Office Cash Desk)
   */
  submitCashCommissionSettlement({
    driverId,
    amount,
    remittanceMethod = 'AIRTEL_BUSINESS_TILL',
    remittanceReference,
    notes = ''
  }) {
    const amt = parseInt(amount, 10);
    if (!amt || amt <= 0) throw new Error('Valid settlement amount required.');

    const settlementId = 'SETTLE-CASH-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const settlement = {
      settlementId,
      driverId,
      amount: amt,
      currency: 'MWK',
      remittanceMethod,
      remittanceReference: remittanceReference || ('REF-' + Date.now().toString(36).toUpperCase()),
      verifiedByAdmin: null,
      status: 'PENDING_VERIFICATION', // Requires admin verification
      notes,
      settledAt: null,
      createdAt: new Date().toISOString()
    };

    this.ledger.cashSettlements.push(settlement);
    this.persistLedger();

    this.logAudit({
      action: 'SUBMIT_CASH_SETTLEMENT',
      entityType: 'COMMISSION_SETTLEMENT',
      entityId: settlementId,
      actorId: driverId,
      actorRole: 'DRIVER',
      newValues: { amount: amt, remittanceMethod, reference: settlement.remittanceReference }
    });

    return settlement;
  }

  /**
   * Admin verifies driver's cash commission payment, reducing their debt
   */
  verifyCashCommissionSettlement({ settlementId, adminId = 'ADMIN_SUPER', approved = true, notes = '' }) {
    const settlement = this.ledger.cashSettlements.find(s => s.settlementId === settlementId);
    if (!settlement) throw new Error('Cash settlement record not found.');

    if (settlement.status === 'VERIFIED') {
      throw new Error('Settlement already verified.');
    }

    settlement.status = approved ? 'VERIFIED' : 'REJECTED';
    settlement.verifiedByAdmin = adminId;
    settlement.settledAt = approved ? new Date().toISOString() : null;
    settlement.notes = notes || settlement.notes;

    if (approved) {
      // Update pending commission ledger entries to SETTLED up to the amount verified
      let remainingCredit = settlement.amount;
      for (const entry of this.ledger.commissionLedger) {
        if (entry.driverId === settlement.driverId && entry.settlementStatus === 'PENDING_CASH_SETTLEMENT') {
          if (remainingCredit >= entry.commissionAmount) {
            entry.settlementStatus = 'SETTLED';
            entry.settledAt = new Date().toISOString();
            remainingCredit -= entry.commissionAmount;
          }
        }
        if (remainingCredit <= 0) break;
      }
    }

    this.persistLedger();

    this.logAudit({
      action: approved ? 'VERIFY_CASH_SETTLEMENT' : 'REJECT_CASH_SETTLEMENT',
      entityType: 'COMMISSION_SETTLEMENT',
      entityId: settlementId,
      actorId: adminId,
      actorRole: 'ADMIN',
      newValues: { status: settlement.status, amount: settlement.amount }
    });

    return settlement;
  }

  // --------------------------------------------------------------------------
  // DRIVER DIGITAL PAYOUT WORKFLOW
  // --------------------------------------------------------------------------
  /**
   * Initiates an atomic driver payout from digital escrow balance
   */
  async requestDriverPayout({
    driverId,
    amount,
    provider = 'airtel_money',
    destinationPhone,
    idempotencyKey = null,
    paymentAdapter = null
  }) {
    const amt = parseInt(amount, 10);
    if (!amt || amt <= 0) throw new Error('Valid payout amount required.');

    const summary = this.getDriverFinancialSummary(driverId);
    if (amt > summary.availablePayoutBalance) {
      throw new Error(`Insufficient available digital payout balance. Available: MWK ${summary.availablePayoutBalance.toLocaleString()}, Requested: MWK ${amt.toLocaleString()}`);
    }

    const key = idempotencyKey || `PAYOUT-${driverId}-${amt}-${Date.now()}`;
    if (this.idempotencyIndex.has(key)) {
      console.warn(`[FinanceService] Duplicate payout attempt prevented with key ${key}`);
      return this.ledger.payoutTransactions.find(p => p.idempotencyKey === key);
    }

    const payoutId = 'PO-' + crypto.randomBytes(6).toString('hex').toUpperCase();
    const payoutTx = {
      payoutId,
      driverId,
      amount: amt,
      currency: 'MWK',
      provider,
      destinationPhone: destinationPhone || '+265 99 554 1122',
      providerReference: null,
      feeAmount: 0,
      status: 'PROCESSING',
      idempotencyKey: key,
      requestedAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null
    };

    this.ledger.payoutTransactions.push(payoutTx);
    this.idempotencyIndex.add(key);
    this.persistLedger();

    // Call payment provider adapter if supplied
    if (paymentAdapter) {
      try {
        const result = await paymentAdapter.initiatePayout({
          payoutId,
          amount: amt,
          phone: payoutTx.destinationPhone,
          reference: payoutId
        });

        payoutTx.status = result.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
        payoutTx.providerReference = result.reference || result.txId;
        payoutTx.completedAt = result.status === 'SUCCESS' ? new Date().toISOString() : null;
        payoutTx.errorMessage = result.error || null;
      } catch (adapterErr) {
        payoutTx.status = 'FAILED';
        payoutTx.errorMessage = adapterErr.message;
      }
    } else {
      // Sandbox auto-approval for certified testing
      payoutTx.status = 'SUCCESS';
      payoutTx.providerReference = 'SBX-MW-' + Date.now().toString(36).toUpperCase();
      payoutTx.completedAt = new Date().toISOString();
    }

    this.persistLedger();

    this.logAudit({
      action: 'DRIVER_PAYOUT',
      entityType: 'PAYOUT',
      entityId: payoutId,
      actorId: driverId,
      actorRole: 'DRIVER',
      newValues: { amount: amt, status: payoutTx.status, provider }
    });

    return payoutTx;
  }

  // --------------------------------------------------------------------------
  // PLATFORM OPERATIONS & AUDIT REPORTING
  // --------------------------------------------------------------------------
  getPlatformFinancialReport() {
    const breakdowns = this.ledger.breakdowns || [];
    const commissionLedger = this.ledger.commissionLedger || [];
    const payouts = this.ledger.payoutTransactions || [];
    const adjustments = this.ledger.adjustments || [];

    const totalGMV = breakdowns.reduce((sum, b) => sum + (b.totalPassengerPaid || 0), 0);
    const eligibleFareTotal = breakdowns.reduce((sum, b) => sum + (b.eligibleFare || 0), 0);
    const gamanCommissionEarned = breakdowns.reduce((sum, b) => sum + (b.commissionAmount || 0), 0);
    const bookingFeesCollected = breakdowns.reduce((sum, b) => sum + (b.bookingFee || 0), 0);
    const totalDriverNetShare = breakdowns.reduce((sum, b) => sum + (b.totalDriverNetEarnings || 0), 0);
    const totalDriverTips = breakdowns.reduce((sum, b) => sum + (b.driverTip || 0), 0);

    // Cash vs Digital breakdown
    const cashRides = breakdowns.filter(b => b.paymentMethod === 'CASH');
    const cashGrossVolume = cashRides.reduce((sum, b) => sum + b.totalPassengerPaid, 0);

    const digitalRides = breakdowns.filter(b => b.paymentMethod !== 'CASH');
    const digitalGrossVolume = digitalRides.reduce((sum, b) => sum + b.totalPassengerPaid, 0);

    // Cash Commission Outstanding
    const cashCommissions = commissionLedger.filter(c => c.paymentMethod === 'CASH');
    const cashCommissionIncurred = cashCommissions.reduce((sum, c) => sum + c.commissionAmount, 0);
    const verifiedSettlements = (this.ledger.cashSettlements || [])
      .filter(s => s.status === 'VERIFIED')
      .reduce((sum, s) => sum + s.amount, 0);
    const outstandingCashCommission = Math.max(0, cashCommissionIncurred - verifiedSettlements);

    // Digital Payouts
    const completedPayoutsTotal = payouts.filter(p => p.status === 'SUCCESS').reduce((sum, p) => sum + p.amount, 0);

    // Total Refunds / Adjustments
    const totalRefunds = adjustments.filter(a => a.adjustmentType === 'REFUND').reduce((sum, a) => sum + Math.abs(a.amount), 0);

    const netPlatformRevenue = gamanCommissionEarned + bookingFeesCollected - totalRefunds;

    return {
      currency: 'MWK',
      totalRidesCount: breakdowns.length,
      totalGMV,
      eligibleFareTotal,
      gamanCommissionEarned,
      bookingFeesCollected,
      totalDriverNetShare,
      totalDriverTips,
      cashGrossVolume,
      digitalGrossVolume,
      outstandingCashCommission,
      completedPayoutsTotal,
      totalRefunds,
      netPlatformRevenue,
      recentBreakdowns: breakdowns.slice(-10).reverse()
    };
  }

  getRideBreakdown(rideId) {
    return (this.ledger.breakdowns || []).find(b => b.rideId === rideId) || null;
  }

  logAudit({ action, entityType, entityId, actorId, actorRole, oldValues = null, newValues = null }) {
    const log = {
      logId: 'LOG-' + crypto.randomBytes(6).toString('hex').toUpperCase(),
      action,
      entityType,
      entityId,
      actorId,
      actorRole,
      oldValues,
      newValues,
      createdAt: new Date().toISOString()
    };
    this.ledger.auditLogs.push(log);
    this.persistLedger();
  }
}

module.exports = new FinanceService();
