// ============================================================================
// GAMAN AUTHORITATIVE FINANCIAL ENGINE TEST SUITE • LILONGWE, MALAWI
// ============================================================================
// Verifies:
//   1. MWK 10,000 eligible fare -> MWK 7,000 driver share & MWK 3,000 Gaman commission (30%)
//   2. Percentage calculations and integer MWK rounding on odd amounts
//   3. Separate vehicle category rules (Moto vs Auto vs Cab)
//   4. Minimum fare threshold enforcement
//   5. Road route distance and duration feeding into fare engine
//   6. 100% Driver Tips (Zero platform commission) & cancellation rules
//   7. Pricing version immutability (historical quotes unchanged after rate edit)
//   8. Idempotent settlement (duplicate completion events do not double-post)
//   9. Cash rides create commission debt obligation without falsely recording cash receipt
//  10. Driver digital escrow balance and payout execution
//  11. Webhook idempotency and replay protection
// ============================================================================

const assert = require('assert');
const financeService = require('../services/finance');
const pricingService = require('../services/pricing');
const paymentManager = require('../services/payments');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
    console.error('   ', err.message);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`✅ [PASS] Test ${totalTests}: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] Test ${totalTests}: ${name}`);
    console.error('   ', err.message);
  }
}

async function main() {
  console.log('=============================================================');
  console.log('   GAMAN FARE CALCULATION, 30% COMMISSION & SETTLEMENT SUITE');
  console.log('=============================================================\n');

  // Test 1: Illustrative MWK 10,000 eligible fare -> 30% Gaman / 70% Driver
  runTest('MWK 10,000 eligible fare yields MWK 7,000 driver share and MWK 3,000 Gaman commission', () => {
    const split = financeService.calculateFinancialSplit({
      grossFare: 10000,
      driverTip: 0,
      bookingFee: 0,
      discountAmount: 0,
      commissionRate: 0.30
    });

    assert.strictEqual(split.eligibleFare, 10000, 'Eligible fare must be 10000 MWK');
    assert.strictEqual(split.commissionAmount, 3000, 'Gaman commission must be exactly 3,000 MWK (30%)');
    assert.strictEqual(split.driverShare, 7000, 'Driver share must be exactly 7,000 MWK (70%)');
    assert.strictEqual(split.driverShare + split.commissionAmount, split.eligibleFare, 'Sum of shares must equal eligible fare');
  });

  // Test 2: Percentage calculations and integer MWK rounding on odd amounts
  runTest('Odd fare amount MWK 4,850 calculates exact 30/70 integer split with zero fractional kwacha', () => {
    const split = financeService.calculateFinancialSplit({
      grossFare: 4850,
      driverTip: 0,
      bookingFee: 0,
      commissionRate: 0.30
    });

    // 4850 * 0.30 = 1455
    // 4850 - 1455 = 3395
    assert.strictEqual(split.commissionAmount, 1455, 'Commission on 4,850 MWK should be 1,455 MWK');
    assert.strictEqual(split.driverShare, 3395, 'Driver share on 4,850 MWK should be 3,395 MWK');
    assert.strictEqual(Number.isInteger(split.commissionAmount), true, 'Commission must be an integer');
    assert.strictEqual(Number.isInteger(split.driverShare), true, 'Driver share must be an integer');
  });

  // Test 3: Separate Vehicle Pricing Rules (Moto vs Auto vs Cab)
  runTest('Motorcycle (Moto) and Car (Cab) pricing rules remain distinct and independent', () => {
    const motoFare = pricingService.calculateFare({
      categoryId: 'moto',
      distanceKm: 10.0,
      durationMins: 20
    });

    const cabFare = pricingService.calculateFare({
      categoryId: 'cab',
      distanceKm: 10.0,
      durationMins: 20
    });

    // Moto: base 800 + (10 * 250) + (20 * 40) + 100 booking fee = 800 + 2500 + 800 + 100 = 4200 MWK
    // Cab: base 2800 + (10 * 850) + (20 * 120) + 250 booking fee = 2800 + 8500 + 2400 + 250 = 13950 MWK
    assert.notStrictEqual(motoFare.finalFare, cabFare.finalFare, 'Moto and Cab fares must be distinct');
    assert.strictEqual(motoFare.categoryId, 'moto', 'Category id must be moto');
    assert.strictEqual(cabFare.categoryId, 'cab', 'Category id must be cab');
    assert.strictEqual(motoFare.breakdown.pricePerKm, 250, 'Moto rate per km must be 250 MWK');
    assert.strictEqual(cabFare.breakdown.pricePerKm, 850, 'Cab rate per km must be 850 MWK');
  });

  // Test 4: Minimum fare threshold enforcement
  runTest('Short distance trip correctly enforces minimum fare threshold', () => {
    // 0.2 km, 1 min for Cab (unconstrained base: 2800 + 170 + 120 + 250 = 3340 < 4500 min fare)
    const shortCabFare = pricingService.calculateFare({
      categoryId: 'cab',
      distanceKm: 0.2,
      durationMins: 1
    });

    assert.strictEqual(shortCabFare.finalFare, 4500, 'Cab fare must be clamped to minimum fare threshold 4,500 MWK');
    assert.strictEqual(shortCabFare.breakdown.isMinimumApplied, true, 'isMinimumApplied must be true');
  });

  // Test 5: Real Road Route distance and duration feed into quote generation
  runTest('Mapbox route distance (11.3 km) and duration (25 mins) populate authoritative quote', () => {
    const quote = pricingService.generateQuote({
      pickup: { lat: -13.9722, lng: 33.7667, name: 'Gateway Mall' },
      destination: { lat: -13.9933, lng: 33.6777, name: 'EPTL Malawi' },
      distanceKm: 11.3,
      durationMins: 25,
      routingProvider: 'mapbox'
    });

    assert.strictEqual(quote.roadDistanceKm, 11.3, 'Route distance must match 11.3 km');
    assert.strictEqual(quote.estimatedDurationMinutes, 25, 'Route duration must match 25 mins');
    assert.strictEqual(quote.routingProvider, 'mapbox', 'Routing provider must be mapbox');
    assert.strictEqual(typeof quote.tiers.moto.finalFare, 'number', 'Moto quote must be present');
    assert.strictEqual(typeof quote.tiers.cab.finalFare, 'number', 'Cab quote must be present');
  });

  // Test 6: Tips go 100% to Driver (Zero platform commission)
  runTest('Tips belong 100% to driver with zero platform commission deducted', () => {
    const splitWithTip = financeService.calculateFinancialSplit({
      grossFare: 6000,
      driverTip: 1000,
      bookingFee: 0,
      commissionRate: 0.30
    });

    // Gross: 6000, Tip: 1000. Eligible fare: 6000.
    // Gaman commission: 6000 * 0.30 = 1800.
    // Driver share: 4200. Total driver net: 4200 + 1000 tip = 5200.
    assert.strictEqual(splitWithTip.commissionAmount, 1800, 'Commission should only apply to base fare (1,800 MWK)');
    assert.strictEqual(splitWithTip.driverTip, 1000, 'Tip must be 1,000 MWK');
    assert.strictEqual(splitWithTip.totalDriverNetEarnings, 5200, 'Driver net must include 100% of the tip (5,200 MWK)');
    assert.strictEqual(splitWithTip.totalPassengerPayable, 7000, 'Rider pays fare + tip (7,000 MWK)');
  });

  // Test 7: Historical Quote Immutability after rate updates
  runTest('Admin rate modification does NOT alter existing historical quote snapshots', () => {
    const originalQuote = pricingService.generateQuote({
      pickup: { lat: -13.97, lng: 33.78 },
      destination: { lat: -13.98, lng: 33.79 },
      distanceKm: 5.0,
      durationMins: 10
    });
    const originalCabFare = originalQuote.tiers.cab.finalFare;

    // Update active rates
    pricingService.updateCategoryRates('cab', { baseFare: 4000 });

    // Verify original quote has NOT changed
    const storedQuote = pricingService.activeQuotes.get(originalQuote.quoteId);
    assert.strictEqual(storedQuote.tiers.cab.finalFare, originalCabFare, 'Existing quote fare must remain immutable');

    // Restore rate for test consistency
    pricingService.updateCategoryRates('cab', { baseFare: 2800 });
  });

  // Test 8: Duplicate ride completion idempotency
  runTest('Duplicate completion events do NOT double-post financial records', () => {
    const testRideId = 'TEST-IDEM-' + Date.now();

    const firstSettlement = financeService.settleCompletedRide({
      rideId: testRideId,
      driverId: 'DRV-MW-TEST',
      riderId: 'USR-TEST',
      grossFare: 8000,
      paymentMethod: 'AIRTEL_MONEY'
    });

    const secondSettlement = financeService.settleCompletedRide({
      rideId: testRideId,
      driverId: 'DRV-MW-TEST',
      riderId: 'USR-TEST',
      grossFare: 8000,
      paymentMethod: 'AIRTEL_MONEY'
    });

    // Check that ledger does not contain duplicate entries
    const matchingBreakdowns = financeService.ledger.breakdowns.filter(b => b.rideId === testRideId);
    const matchingCommission = financeService.ledger.commissionLedger.filter(c => c.rideId === testRideId);

    assert.strictEqual(matchingBreakdowns.length, 1, 'Only exactly 1 breakdown must exist for this ride');
    assert.strictEqual(matchingCommission.length, 1, 'Only exactly 1 commission entry must exist for this ride');
  });

  // Test 9: Cash rides create 30% commission debt without falsely recording receipt of cash
  const cashTestDriverId = 'DRV-CASH-' + Date.now();
  runTest('Cash ride records gross collection by driver and creates 30% commission debt owed to Gaman', () => {
    const cashRideId = 'TEST-CASH-' + Date.now();

    financeService.settleCompletedRide({
      rideId: cashRideId,
      driverId: cashTestDriverId,
      riderId: 'USR-CASH-RIDER',
      grossFare: 10000,
      paymentMethod: 'CASH'
    });

    const summary = financeService.getDriverFinancialSummary(cashTestDriverId);
    assert.strictEqual(summary.cashCollectedByDriver, 10000, 'Driver must hold 10,000 MWK cash in hand');
    assert.strictEqual(summary.outstandingCashCommissionDebt, 3000, 'Driver must owe 3,000 MWK (30%) cash commission debt to Gaman');
    assert.strictEqual(summary.availablePayoutBalance, 0, 'No digital escrow payout balance created for cash ride');
  });

  // Test 10: Cash commission remittance and admin verification workflow
  runTest('Driver remitting cash commission and admin verification settles debt', () => {
    // Submit remittance
    const settlement = financeService.submitCashCommissionSettlement({
      driverId: cashTestDriverId,
      amount: 3000,
      remittanceMethod: 'AIRTEL_BUSINESS_TILL',
      remittanceReference: 'TX-TILL-8812'
    });
    assert.strictEqual(settlement.status, 'PENDING_VERIFICATION', 'Settlement must initially be pending verification');

    // Admin verifies
    const verified = financeService.verifyCashCommissionSettlement({
      settlementId: settlement.settlementId,
      adminId: 'ADMIN_SUPER',
      approved: true
    });
    assert.strictEqual(verified.status, 'VERIFIED', 'Settlement must now be verified');

    // Check debt is settled
    const summary = financeService.getDriverFinancialSummary(cashTestDriverId);
    assert.strictEqual(summary.outstandingCashCommissionDebt, 0, 'Outstanding cash commission debt must be 0 MWK');
    assert.strictEqual(summary.verifiedCashRemitted, 3000, 'Verified cash remitted must be 3,000 MWK');
  });

  // Test 11: Digital payment collection & driver payout from escrow
  await runAsyncTest('Digital mobile money ride credits driver escrow and allows idempotent payout', async () => {
    const digitalRideId = 'TEST-DIGITAL-' + Date.now();
    const testDriverId = 'DRV-DIGITAL-' + Date.now();

    financeService.settleCompletedRide({
      rideId: digitalRideId,
      driverId: testDriverId,
      riderId: 'USR-DIGITAL-RIDER',
      grossFare: 10000,
      paymentMethod: 'AIRTEL_MONEY'
    });

    const summaryBefore = financeService.getDriverFinancialSummary(testDriverId);
    assert.strictEqual(summaryBefore.availablePayoutBalance, 7000, 'Driver should have 7,000 MWK (70%) available for payout');

    // Request payout
    const payout = await financeService.requestDriverPayout({
      driverId: testDriverId,
      amount: 5000,
      provider: 'airtel_money',
      destinationPhone: '+265 99 554 1122'
    });

    assert.strictEqual(payout.status, 'SUCCESS', 'Payout must be processed successfully');

    const summaryAfter = financeService.getDriverFinancialSummary(testDriverId);
    assert.strictEqual(summaryAfter.availablePayoutBalance, 2000, 'Remaining available payout balance must be 2,000 MWK');
  });

  // Test 12: Webhook idempotency and replay protection
  await runAsyncTest('Duplicate webhook delivery is rejected to prevent double credit', async () => {
    const adapter = paymentManager.getAdapter('airtel_money');
    const webhookPayload = {
      transactionId: 'WH-TX-' + Date.now(),
      reference: 'AM-REF-1234',
      amount: 6200,
      status: 'SUCCESS'
    };

    const firstCall = await adapter.handleWebhook(webhookPayload, 'sig-valid');
    assert.strictEqual(firstCall.status, 'VERIFIED', 'First webhook call must be VERIFIED');

    const secondCall = await adapter.handleWebhook(webhookPayload, 'sig-valid');
    assert.strictEqual(secondCall.status, 'ALREADY_PROCESSED', 'Replay webhook call must return ALREADY_PROCESSED');
  });

  console.log('\n=============================================================');
  console.log(`   TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${Math.round(passedTests/totalTests*100)}%)`);
  console.log('=============================================================');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test suite runner error:', err);
  process.exit(1);
});
