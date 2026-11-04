// ============================================================================
// AAROHAN DOUBLE-ENTRY DATABASE LEDGER SERVICE • LILONGWE, MALAWI
// ============================================================================
// Enforces:
//   - Strict double-entry accounting: all entries for a journalId SUM TO ZERO
//   - Atomic wallet and ledger changes in one prisma.$transaction
//   - Integer MWK currency (never floats)
//   - 30% Platform Commission / 70% Driver Share on rides
//   - 100% Tips directly to driver (0% commission)
//   - Cash collection accounting with commission debt
// ============================================================================

const crypto = require('crypto');
const prisma = require('../lib/prisma');

class DbLedgerService {
  /**
   * Generates a standard UUID for journal grouping.
   */
  generateJournalId() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  }

  /**
   * Top-up rider or driver wallet with external mobile money deposit.
   * Double-Entry Legs:
   *   1. RIDER account (Credit to user wallet liability): +amountMWK
   *   2. PLATFORM_ESCROW account (Offsetting escrow asset): -amountMWK
   *   Sum: +amountMWK + (-amountMWK) = 0
   */
  async recordWalletTopup({ userId, amountMWK, provider = 'AIRTEL_MONEY', idempotencyKey, reference = null }) {
    const amount = Math.max(0, parseInt(amountMWK, 10));
    if (amount <= 0) throw new Error('Top-up amount must be strictly greater than 0 MWK');

    const journalId = this.generateJournalId();
    const idemKey = idempotencyKey || `TOPUP-${userId}-${Date.now()}`;

    return await prisma.$transaction(async (tx) => {
      // 1. Get or create user wallet
      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({ data: { userId, balanceMWK: 0 } });
      }

      // 2. Increment wallet balance
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceMWK: { increment: amount } }
      });

      // 3. Create RIDER leg (+amount)
      const riderLeg = await tx.ledgerEntry.create({
        data: {
          journalId,
          account: 'RIDER',
          userId,
          walletId: wallet.id,
          type: 'WALLET_TOPUP',
          amountMWK: amount,
          balanceAfterMWK: updatedWallet.balanceMWK,
          currency: 'MWK',
          description: `Wallet top-up via ${provider}`,
          idempotencyKey: `${idemKey}-RIDER`,
          reference
        }
      });

      // 4. Create PLATFORM_ESCROW leg (-amount)
      const escrowLeg = await tx.ledgerEntry.create({
        data: {
          journalId,
          account: 'PLATFORM_ESCROW',
          userId: null,
          walletId: null,
          type: 'WALLET_TOPUP',
          amountMWK: -amount,
          balanceAfterMWK: 0,
          currency: 'MWK',
          description: `Platform escrow allocation for top-up via ${provider}`,
          idempotencyKey: `${idemKey}-ESCROW`,
          reference
        }
      });

      return {
        journalId,
        wallet: updatedWallet,
        entries: [riderLeg, escrowLeg],
        netBalanceSum: riderLeg.amountMWK + escrowLeg.amountMWK // Strictly 0
      };
    }, { maxWait: 10000, timeout: 30000 });
  }

  /**
   * P2P Transfer between two users.
   * Double-Entry Legs:
   *   1. Sender RIDER account: -amountMWK
   *   2. Recipient RIDER account: +amountMWK
   *   Sum: -amountMWK + amountMWK = 0
   */
  async recordP2PTransfer({ senderUserId, recipientUserId, amountMWK, idempotencyKey }) {
    const amount = Math.max(0, parseInt(amountMWK, 10));
    if (amount <= 0) throw new Error('Transfer amount must be strictly greater than 0 MWK');

    const journalId = this.generateJournalId();
    const idemKey = idempotencyKey || `P2P-${senderUserId}-${recipientUserId}-${Date.now()}`;

    return await prisma.$transaction(async (tx) => {
      const senderWallet = await tx.wallet.findUnique({ where: { userId: senderUserId } });
      if (!senderWallet || senderWallet.balanceMWK < amount) {
        throw new Error('Insufficient wallet balance for transfer');
      }

      let recipientWallet = await tx.wallet.findUnique({ where: { userId: recipientUserId } });
      if (!recipientWallet) {
        recipientWallet = await tx.wallet.create({ data: { userId: recipientUserId, balanceMWK: 0 } });
      }

      // Update wallets
      const updatedSender = await tx.wallet.update({
        where: { id: senderWallet.id },
        data: { balanceMWK: { decrement: amount } }
      });

      const updatedRecipient = await tx.wallet.update({
        where: { id: recipientWallet.id },
        data: { balanceMWK: { increment: amount } }
      });

      // Sender leg (debit -)
      const senderLeg = await tx.ledgerEntry.create({
        data: {
          journalId,
          account: 'RIDER',
          userId: senderUserId,
          walletId: senderWallet.id,
          type: 'P2P_TRANSFER_DEBIT',
          amountMWK: -amount,
          balanceAfterMWK: updatedSender.balanceMWK,
          currency: 'MWK',
          description: `P2P transfer to user ${recipientUserId}`,
          idempotencyKey: `${idemKey}-DEBIT`
        }
      });

      // Recipient leg (credit +)
      const recipientLeg = await tx.ledgerEntry.create({
        data: {
          journalId,
          account: 'RIDER',
          userId: recipientUserId,
          walletId: recipientWallet.id,
          type: 'P2P_TRANSFER_CREDIT',
          amountMWK: amount,
          balanceAfterMWK: updatedRecipient.balanceMWK,
          currency: 'MWK',
          description: `P2P transfer from user ${senderUserId}`,
          idempotencyKey: `${idemKey}-CREDIT`
        }
      });

      return {
        journalId,
        senderWallet: updatedSender,
        recipientWallet: updatedRecipient,
        entries: [senderLeg, recipientLeg],
        netBalanceSum: senderLeg.amountMWK + recipientLeg.amountMWK // Strictly 0
      };
    }, { maxWait: 10000, timeout: 30000 });
  }

  /**
   * Settle completed ride fare with authoritative 30% platform / 70% driver split.
   * For Cash Rides:
   *   Driver collected gross cash from passenger.
   *   Leg 1 (Driver Commission Debt): -commissionMWK
   *   Leg 2 (Platform Revenue):       +commissionMWK
   *   Sum: -commissionMWK + commissionMWK = 0
   *
   * For Digital / Wallet Rides:
   *   Passenger wallet deducted total (fare + tip).
   *   Driver credited net share (70% fare + 100% tip).
   *   Platform credited 30% commission.
   *   Leg 1 (Rider):    -(fareMWK + tip)
   *   Leg 2 (Driver):   +(driverShare + tip)
   *   Leg 3 (Platform): +commissionMWK
   *   Sum: -(fareMWK + tip) + (driverShare + tip) + commissionMWK = 0
   */
  async settleRide({
    tripId,
    paymentMethod = 'CASH',
    driverTipMWK = 0,
    changedBy = 'DRIVER',
    idempotencyKey
  }) {
    const journalId = this.generateJournalId();
    const idemKey = idempotencyKey || `SETTLE-${tripId}-${Date.now()}`;

    return await prisma.$transaction(async (tx) => {
      // 1. Fetch authoritative trip with rider and driver
      const trip = await tx.trip.findUnique({
        where: { id: tripId },
        include: {
          rider: { include: { wallet: true } },
          driver: { include: { user: { include: { wallet: true } } } }
        }
      });

      if (!trip) throw new Error(`Trip ${tripId} not found`);
      if (trip.status === 'COMPLETED') {
        throw new Error(`Trip ${tripId} has already been completed`);
      }

      const fareMWK = trip.fareMWK;
      const commissionMWK = Math.round(fareMWK * 0.30);
      const driverShareMWK = fareMWK - commissionMWK;
      const tipMWK = Math.max(0, parseInt(driverTipMWK, 10) || trip.driverTipMWK || 0);
      const totalDriverEarnings = driverShareMWK + tipMWK;

      const isCash = paymentMethod.toUpperCase().includes('CASH');
      const entries = [];

      if (isCash) {
        // Driver collected all cash. Platform records 30% commission debt on driver.
        if (trip.driver) {
          await tx.driver.update({
            where: { id: trip.driver.id },
            data: {
              commissionDebtMWK: { increment: commissionMWK },
              tripsCompleted: { increment: 1 }
            }
          });
        }

        // Driver leg (liability/debt creation): -commissionMWK
        const driverLeg = await tx.ledgerEntry.create({
          data: {
            journalId,
            account: 'DRIVER',
            userId: trip.driver?.userId || null,
            tripId: trip.id,
            type: 'COMMISSION_DEBT',
            amountMWK: -commissionMWK,
            balanceAfterMWK: (trip.driver?.commissionDebtMWK || 0) + commissionMWK,
            currency: 'MWK',
            description: `30% platform commission debt for cash trip ${trip.id}`,
            idempotencyKey: `${idemKey}-DEBT`
          }
        });
        entries.push(driverLeg);

        // Platform revenue leg: +commissionMWK
        const platformLeg = await tx.ledgerEntry.create({
          data: {
            journalId,
            account: 'PLATFORM_REVENUE',
            userId: null,
            tripId: trip.id,
            type: 'PLATFORM_COMMISSION',
            amountMWK: commissionMWK,
            balanceAfterMWK: 0,
            currency: 'MWK',
            description: `30% platform commission earned from cash trip ${trip.id}`,
            idempotencyKey: `${idemKey}-REVENUE`
          }
        });
        entries.push(platformLeg);

        // Create DriverSettlement record
        await tx.driverSettlement.create({
          data: {
            driverId: trip.driverId,
            tripId: trip.id,
            grossFareMWK: fareMWK,
            driverEarningsMWK: totalDriverEarnings,
            commissionMWK,
            commissionDebtMWK: commissionMWK,
            settlementStatus: 'PENDING_CASH_COLLECTION'
          }
        });

      } else {
        // Digital ride: Deduct rider wallet, credit driver wallet, credit platform revenue
        const totalRiderCost = fareMWK + tipMWK;

        // Ensure rider wallet exists and deduct
        let riderWallet = trip.rider.wallet;
        if (!riderWallet) {
          riderWallet = await tx.wallet.create({ data: { userId: trip.riderId, balanceMWK: 0 } });
        }
        const updatedRiderWallet = await tx.wallet.update({
          where: { id: riderWallet.id },
          data: { balanceMWK: { decrement: totalRiderCost } }
        });

        // Ensure driver user wallet exists and credit
        const driverUserId = trip.driver.userId;
        let driverWallet = trip.driver.user?.wallet;
        if (!driverWallet) {
          driverWallet = await tx.wallet.create({ data: { userId: driverUserId, balanceMWK: 0 } });
        }
        const updatedDriverWallet = await tx.wallet.update({
          where: { id: driverWallet.id },
          data: { balanceMWK: { increment: totalDriverEarnings } }
        });

        if (trip.driver) {
          await tx.driver.update({
            where: { id: trip.driver.id },
            data: { tripsCompleted: { increment: 1 } }
          });
        }

        // Leg 1: Rider Debit
        const riderLeg = await tx.ledgerEntry.create({
          data: {
            journalId,
            account: 'RIDER',
            userId: trip.riderId,
            walletId: riderWallet.id,
            tripId: trip.id,
            type: 'RIDE_FARE',
            amountMWK: -totalRiderCost,
            balanceAfterMWK: updatedRiderWallet.balanceMWK,
            currency: 'MWK',
            description: `Fare payment for trip ${trip.id}`,
            idempotencyKey: `${idemKey}-RIDER`
          }
        });
        entries.push(riderLeg);

        // Leg 2: Driver Credit
        const driverLeg = await tx.ledgerEntry.create({
          data: {
            journalId,
            account: 'DRIVER',
            userId: driverUserId,
            walletId: driverWallet.id,
            tripId: trip.id,
            type: 'DRIVER_EARNING',
            amountMWK: totalDriverEarnings,
            balanceAfterMWK: updatedDriverWallet.balanceMWK,
            currency: 'MWK',
            description: `70% ride earnings + 100% tip for trip ${trip.id}`,
            idempotencyKey: `${idemKey}-DRIVER`
          }
        });
        entries.push(driverLeg);

        // Leg 3: Platform Commission
        const platformLeg = await tx.ledgerEntry.create({
          data: {
            journalId,
            account: 'PLATFORM_REVENUE',
            userId: null,
            tripId: trip.id,
            type: 'PLATFORM_COMMISSION',
            amountMWK: commissionMWK,
            balanceAfterMWK: 0,
            currency: 'MWK',
            description: `30% platform commission on digital trip ${trip.id}`,
            idempotencyKey: `${idemKey}-PLATFORM`
          }
        });
        entries.push(platformLeg);

        // Create DriverSettlement record
        await tx.driverSettlement.create({
          data: {
            driverId: trip.driverId,
            tripId: trip.id,
            grossFareMWK: fareMWK,
            driverEarningsMWK: totalDriverEarnings,
            commissionMWK,
            commissionDebtMWK: 0,
            settlementStatus: 'SETTLED'
          }
        });
      }

      // Update Trip status to COMPLETED
      const completedTrip = await tx.trip.update({
        where: { id: trip.id },
        data: {
          status: 'COMPLETED',
          paymentMethod: isCash ? 'CASH' : 'WALLET_ESCROW',
          paymentStatus: 'SUCCESS',
          driverTipMWK: tipMWK,
          completedAt: new Date()
        }
      });

      // Record TripStatusHistory
      await tx.tripStatusHistory.create({
        data: {
          tripId: trip.id,
          fromStatus: trip.status,
          status: 'COMPLETED',
          changedBy,
          reason: 'Slide to complete ride verified'
        }
      });

      // Calculate sum of all journal entries
      const netBalanceSum = entries.reduce((acc, row) => acc + row.amountMWK, 0);

      return {
        trip: completedTrip,
        journalId,
        entries,
        netBalanceSum, // Strictly 0
        breakdown: {
          fareMWK,
          commissionMWK,
          driverShareMWK,
          tipMWK,
          totalDriverEarnings
        }
      };
    }, { maxWait: 10000, timeout: 30000 });
  }

  /**
   * Driver Commission Settlement:
   * Approves a settlement payment from driver to platform, reducing Driver.commissionDebtMWK
   * and writing a balanced double-entry ledger journal in ONE database transaction.
   *
   * Balanced Legs:
   *   1. DRIVER account (DEBT_SETTLEMENT): +amountMWK (reduces liability/debt)
   *   2. PLATFORM_REVENUE account (DEBT_SETTLEMENT): -amountMWK (offsetting leg)
   *   Sum: +amountMWK + (-amountMWK) = 0
   */
  async recordCommissionSettlement({
    driverId,
    amountMWK,
    reference,
    settlementId = null,
    verifiedByUserId = null,
    notes = ''
  }) {
    const amount = Math.max(0, parseInt(amountMWK, 10));
    if (amount <= 0) throw new Error('Settlement amount must be strictly greater than 0 MWK');

    const journalId = this.generateJournalId();
    const idemKey = `SETTLE-${driverId}-${settlementId || Date.now()}`;

    return await prisma.$transaction(async (tx) => {
      // 1. Fetch authoritative driver
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        include: { user: true }
      });
      if (!driver) throw new Error(`Driver ${driverId} not found`);

      const previousDebt = driver.commissionDebtMWK;
      const newDebt = Math.max(0, previousDebt - amount);

      // 2. Atomically reduce Driver.commissionDebtMWK
      const updatedDriver = await tx.driver.update({
        where: { id: driver.id },
        data: { commissionDebtMWK: newDebt }
      });

      // 3. Leg 1: DRIVER account credit
      const driverLeg = await tx.ledgerEntry.create({
        data: {
          journalId,
          account: 'DRIVER',
          userId: driver.userId,
          type: 'DEBT_SETTLEMENT',
          amountMWK: amount,
          balanceAfterMWK: newDebt,
          currency: 'MWK',
          description: `Commission settlement verification (Ref: ${reference || 'N/A'})`,
          idempotencyKey: `${idemKey}-DRIVER`,
          reference: reference || null
        }
      });

      // 4. Leg 2: PLATFORM_REVENUE offsetting leg
      const platformLeg = await tx.ledgerEntry.create({
        data: {
          journalId,
          account: 'PLATFORM_REVENUE',
          userId: null,
          type: 'DEBT_SETTLEMENT',
          amountMWK: -amount,
          balanceAfterMWK: 0,
          currency: 'MWK',
          description: `Platform collection of driver commission remittance (Ref: ${reference || 'N/A'})`,
          idempotencyKey: `${idemKey}-PLATFORM`,
          reference: reference || null
        }
      });

      // 5. Create immutable AuditLog row
      const auditLog = await tx.auditLog.create({
        data: {
          userId: verifiedByUserId,
          action: 'COMMISSION_SETTLED',
          entityType: 'DRIVER',
          entityId: driver.id,
          details: {
            settlementId,
            amountMWK: amount,
            reference,
            previousDebtMWK: previousDebt,
            newDebtMWK: newDebt,
            journalId,
            notes
          }
        }
      });

      const entries = [driverLeg, platformLeg];
      const netBalanceSum = driverLeg.amountMWK + platformLeg.amountMWK;

      return {
        journalId,
        driver: updatedDriver,
        previousDebtMWK: previousDebt,
        newDebtMWK: newDebt,
        settledAmountMWK: amount,
        entries,
        netBalanceSum, // Strictly 0
        auditLog
      };
    }, { maxWait: 10000, timeout: 30000 });
  }

  /**
   * Helper to verify that all ledger entries for a journalId sum to exactly zero.
   */
  async verifyJournalBalance(journalId) {
    const entries = await prisma.ledgerEntry.findMany({
      where: { journalId }
    });
    const sum = entries.reduce((acc, row) => acc + row.amountMWK, 0);
    return {
      journalId,
      entryCount: entries.length,
      sum,
      isBalanced: sum === 0,
      entries
    };
  }
}

module.exports = new DbLedgerService();
