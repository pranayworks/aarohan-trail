// ============================================================================
// GAMAN CONFIGURABLE PRICING ENGINE • LILONGWE, MALAWI
// ============================================================================
// Features:
//   - Admin-Managed Multi-Version Pricing Architecture
//   - Strict Documented Order of Operations:
//       1. Base Fare + (Road Distance * perKm) + (Duration * perMinute)
//       2. Demand Multiplier (Disabled by default, applied to distance/time fare only)
//       3. Applicable Fees (Booking fee, Waiting charges)
//       4. Minimum Fare Threshold Check
//       5. Promotional Discounts (Applied to eligible fare only)
//       6. Integer MWK Rounding (Nearest 50 MWK)
//       7. Authoritative 30% Gaman Commission / 70% Driver Share
//   - Route Provider Snapshot (Mapbox Directions) & 10-Minute Expiring Quotes
//   - Separate, Independent Rules for Cars (Cab), Tuk-Tuks (Auto) & Motorcycles (Moto)
// ============================================================================

const crypto = require('crypto');

// Initial Verified Launch Pricing Version (AAROHAN-PRICE-V1)
const INITIAL_PRICING_VERSIONS = [
  {
    versionId: 'AAROHAN-PRICE-V1',
    versionName: 'Lilongwe Standard Urban Mobility Tariffs 2026',
    effectiveFrom: new Date('2026-01-01T00:00:00Z').toISOString(),
    isActive: true,
    currency: 'MWK',
    commissionRate: 0.30, // 30% AArohan Commission
    driverShareRate: 0.70, // 70% Driver Share
    roundingUnit: 50,
    bookingFee: 150,
    demandMultiplierEnabled: false,
    defaultDemandMultiplier: 1.00,
    waitingChargePerMin: 50,
    freeWaitingMins: 3,
    cancellationFee: 1000,
    notes: 'Approved launch baseline pricing version for Lilongwe district',
    categories: {
      moto: {
        id: 'moto',
        name: 'AArohan Moto',
        subtitle: 'Fastest through Lilongwe traffic',
        icon: 'two_wheeler',
        capacity: '1 rider',
        baseFare: 800,
        pricePerKm: 250,
        pricePerMinute: 40,
        minimumFare: 1200,
        bookingFee: 100,
        cancellationFee: 500
      },
      auto: {
        id: 'auto',
        name: 'AArohan Auto',
        subtitle: 'Comfortable & sheltered local ride',
        icon: 'electric_rickshaw',
        capacity: '3 riders',
        baseFare: 1400,
        pricePerKm: 450,
        pricePerMinute: 60,
        minimumFare: 2200,
        bookingFee: 150,
        cancellationFee: 800
      },
      cab: {
        id: 'cab',
        name: 'AArohan Cab',
        subtitle: 'Private air-conditioned car',
        icon: 'local_taxi',
        capacity: '4 riders',
        baseFare: 2800,
        pricePerKm: 850,
        pricePerMinute: 120,
        minimumFare: 4500,
        bookingFee: 250,
        cancellationFee: 1500
      }
    }
  }
];

class PricingService {
  constructor() {
    this.versions = JSON.parse(JSON.stringify(INITIAL_PRICING_VERSIONS));
    this.activeQuotes = new Map(); // quoteId -> immutable quote snapshot

    // Clean up expired quotes periodically
    setInterval(() => {
      const now = Date.now();
      for (const [quoteId, quote] of this.activeQuotes.entries()) {
        if (now > quote.expiresAt) {
          this.activeQuotes.delete(quoteId);
        }
      }
    }, 60000);
  }

  // Get current active pricing version
  getActiveVersion() {
    const active = this.versions.find(v => v.isActive);
    return active || this.versions[0];
  }

  // Get all pricing versions (Admin review)
  getAllVersions() {
    return this.versions;
  }

  // Create or update pricing version
  createPricingVersion({
    versionName,
    categories,
    commissionRate = 0.30,
    driverShareRate = 0.70,
    bookingFee = 150,
    demandMultiplierEnabled = false,
    notes = '',
    makeActive = false,
    actorId = 'ADMIN_SUPER'
  }) {
    const versionId = 'AAROHAN-PRICE-' + Date.now().toString(36).toUpperCase();
    const activeVersion = this.getActiveVersion();

    const mergedCategories = Object.assign({}, activeVersion.categories, categories);

    const newVersion = {
      versionId,
      versionName: versionName || `Custom Pricing Version ${new Date().toLocaleDateString()}`,
      effectiveFrom: new Date().toISOString(),
      isActive: Boolean(makeActive),
      currency: 'MWK',
      commissionRate: parseFloat(commissionRate) || 0.30,
      driverShareRate: parseFloat(driverShareRate) || 0.70,
      roundingUnit: 50,
      bookingFee: parseInt(bookingFee, 10) || 150,
      demandMultiplierEnabled: Boolean(demandMultiplierEnabled),
      defaultDemandMultiplier: 1.00,
      waitingChargePerMin: 50,
      freeWaitingMins: 3,
      cancellationFee: 1000,
      notes,
      categories: mergedCategories,
      createdBy: actorId,
      createdAt: new Date().toISOString()
    };

    if (makeActive) {
      this.versions.forEach(v => { v.isActive = false; });
    }

    this.versions.push(newVersion);
    return newVersion;
  }

  // Activate an existing pricing version
  activateVersion(versionId, actorId = 'ADMIN_SUPER') {
    const target = this.versions.find(v => v.versionId === versionId);
    if (!target) throw new Error(`Pricing version ${versionId} not found.`);

    this.versions.forEach(v => { v.isActive = false; });
    target.isActive = true;
    target.activatedAt = new Date().toISOString();
    target.activatedBy = actorId;
    return target;
  }

  // Update rates for a specific vehicle category in active version
  updateCategoryRates(categoryId, rateUpdates, actorId = 'ADMIN_SUPER') {
    const version = this.getActiveVersion();
    const cat = version.categories[categoryId];
    if (!cat) throw new Error(`Category ${categoryId} does not exist.`);

    const oldValues = Object.assign({}, cat);

    if (rateUpdates.baseFare !== undefined) cat.baseFare = Math.max(0, parseInt(rateUpdates.baseFare, 10));
    if (rateUpdates.pricePerKm !== undefined) cat.pricePerKm = Math.max(0, parseInt(rateUpdates.pricePerKm, 10));
    if (rateUpdates.pricePerMinute !== undefined) cat.pricePerMinute = Math.max(0, parseInt(rateUpdates.pricePerMinute, 10));
    if (rateUpdates.minimumFare !== undefined) cat.minimumFare = Math.max(0, parseInt(rateUpdates.minimumFare, 10));
    if (rateUpdates.bookingFee !== undefined) cat.bookingFee = Math.max(0, parseInt(rateUpdates.bookingFee, 10));
    if (rateUpdates.cancellationFee !== undefined) cat.cancellationFee = Math.max(0, parseInt(rateUpdates.cancellationFee, 10));

    return {
      categoryId,
      oldValues,
      newValues: cat,
      versionId: version.versionId
    };
  }

  // --------------------------------------------------------------------------
  // ORDER OF OPERATIONS: Authoritative Single Fare Calculation
  // --------------------------------------------------------------------------
  /**
   * Implements the exact business formula:
   *   1. distanceCharge = roadDistanceKm * pricePerKm
   *   2. timeCharge = estimatedDurationMinutes * pricePerMinute
   *   3. baseRideTotal = baseFare + distanceCharge + timeCharge
   *   4. if demandMultiplierEnabled: surgedTotal = baseRideTotal * demandMultiplier
   *   5. subtotal = surgedTotal + bookingFee + waitingCharge
   *   6. boundedFare = Math.max(minimumFare, subtotal)
   *   7. finalFare = Math.round(boundedFare / 50) * 50 (MWK integer rounding)
   *   8. Commission split:
   *        - eligibleCommissionBase = finalFare - bookingFee
   *        - Gaman Commission (30%) = Math.round(eligibleCommissionBase * commissionRate)
   *        - Driver Net Share (70%) = eligibleCommissionBase - commissionAmount
   */
  calculateFare({
    categoryId,
    distanceKm,
    durationMins,
    demandMultiplier = 1.0,
    waitingMins = 0,
    discountAmount = 0,
    version = null
  }) {
    const pricingVersion = version || this.getActiveVersion();
    const category = pricingVersion.categories[categoryId];
    if (!category) {
      throw new Error(`Vehicle category '${categoryId}' not found in pricing version ${pricingVersion.versionId}.`);
    }

    const dist = Math.max(0, parseFloat(distanceKm) || 0);
    const time = Math.max(0, parseFloat(durationMins) || 0);
    const waiting = Math.max(0, parseInt(waitingMins, 10) || 0);
    const discount = Math.max(0, parseInt(discountAmount, 10) || 0);

    // 1. Distance & Time Charges
    const distanceCharge = Math.round(dist * category.pricePerKm);
    const timeCharge = Math.round(time * category.pricePerMinute);
    const baseRideTotal = category.baseFare + distanceCharge + timeCharge;

    // 2. Demand Multiplier (Disabled by default unless explicitly active)
    const effectiveMultiplier = (pricingVersion.demandMultiplierEnabled && demandMultiplier > 1.0)
      ? parseFloat(demandMultiplier)
      : 1.00;
    const surgedBaseTotal = Math.round(baseRideTotal * effectiveMultiplier);

    // 3. Waiting Time Charge (after free threshold)
    const chargeableWaitingMins = Math.max(0, waiting - (pricingVersion.freeWaitingMins || 3));
    const waitingCharge = chargeableWaitingMins * (pricingVersion.waitingChargePerMin || 50);

    // 4. Booking Fee
    const bookingFee = category.bookingFee !== undefined ? category.bookingFee : (pricingVersion.bookingFee || 0);

    // 5. Total before minimum fare constraint
    const unconstrainedSubtotal = surgedBaseTotal + bookingFee + waitingCharge - discount;

    // 6. Minimum Fare Threshold Check
    const isMinimumApplied = unconstrainedSubtotal < category.minimumFare;
    const boundedFare = Math.max(category.minimumFare, unconstrainedSubtotal);

    // 7. Currency Integer Rounding (Nearest 50 MWK)
    const roundingUnit = pricingVersion.roundingUnit || 50;
    const finalFare = Math.round(boundedFare / roundingUnit) * roundingUnit;

    // 8. Financial Commission Base (30% Gaman / 70% Driver)
    const commissionRate = pricingVersion.commissionRate || 0.30;
    const eligibleCommissionBase = Math.max(0, finalFare - bookingFee);
    const platformCommission = Math.round(eligibleCommissionBase * commissionRate);
    const driverNetEarnings = eligibleCommissionBase - platformCommission;

    return {
      categoryId: category.id,
      name: category.name,
      subtitle: category.subtitle,
      icon: category.icon,
      capacity: category.capacity,
      finalFare,
      currency: pricingVersion.currency || 'MWK',
      driverNetEarnings, // 70% share of eligible fare
      driverEarnings: driverNetEarnings,
      platformCommission, // 30% Gaman commission
      commissionAmount: platformCommission,
      platformFee: platformCommission + bookingFee,
      baseFare: category.baseFare,
      ratePerKm: category.pricePerKm,
      pricePerKm: category.pricePerKm,
      pricePerMinute: category.pricePerMinute,
      distanceFare: distanceCharge,
      minimumFare: category.minimumFare,
      bookingFee,
      breakdown: {
        baseFare: category.baseFare,
        distanceKm: dist,
        pricePerKm: category.pricePerKm,
        distanceCharge,
        durationMins: time,
        pricePerMinute: category.pricePerMinute,
        timeCharge,
        demandMultiplier: effectiveMultiplier,
        demandMultiplierApplied: effectiveMultiplier > 1.0,
        bookingFee,
        waitingMins,
        waitingCharge,
        discountAmount: discount,
        minimumFare: category.minimumFare,
        isMinimumApplied,
        eligibleCommissionBase,
        commissionRate,
        roundingPolicy: `Nearest ${roundingUnit} MWK`
      },
      pricingVersionId: pricingVersion.versionId
    };
  }

  // --------------------------------------------------------------------------
  // IMMUTABLE FARE QUOTES (Mapbox Route + 10-Minute Signed Token)
  // --------------------------------------------------------------------------
  /**
   * Generates a tamper-proof quote snapshot with Mapbox road distance & duration.
   */
  generateQuote({
    pickup,
    destination,
    distanceKm,
    durationMins,
    routeGeometry,
    routingProvider = 'mapbox',
    demandMultiplier = 1.0
  }) {
    if (!pickup || !destination) {
      throw new Error('Valid pickup and destination coordinates are required for quote generation.');
    }

    const dist = parseFloat(distanceKm);
    const dur = parseFloat(durationMins);

    if (isNaN(dist) || dist <= 0) {
      throw new Error('Valid road distance required from routing provider.');
    }

    const quoteId = 'AAROHAN-QTE-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const activeVersion = this.getActiveVersion();
    const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes

    // Calculate fare for all supported vehicle categories
    const tierQuotes = {};
    for (const catKey of Object.keys(activeVersion.categories)) {
      tierQuotes[catKey] = this.calculateFare({
        categoryId: catKey,
        distanceKm: dist,
        durationMins: dur,
        demandMultiplier,
        version: activeVersion
      });
    }

    const quoteObj = {
      quoteId,
      versionId: activeVersion.versionId,
      createdAt: Date.now(),
      createdAtIso: new Date().toISOString(),
      expiresAt,
      expiresAtIso: new Date(expiresAt).toISOString(),
      roadDistanceKm: dist,
      distanceKm: dist,
      estimatedDurationMinutes: dur,
      durationMins: dur,
      routingProvider,
      routeGeometry: routeGeometry || null,
      pickup: {
        name: pickup.name || 'Pickup Point',
        lat: pickup.lat,
        lng: pickup.lng
      },
      destination: {
        name: destination.name || 'Destination Point',
        lat: destination.lat,
        lng: destination.lng
      },
      demandMultiplier: demandMultiplier || 1.0,
      tiers: tierQuotes,
      signature: crypto.createHmac('sha256', process.env.JWT_SECRET || 'aarohan-platform-secret-lilongwe')
        .update(`${quoteId}:${dist}:${dur}:${activeVersion.versionId}`)
        .digest('hex')
    };

    this.activeQuotes.set(quoteId, quoteObj);
    return quoteObj;
  }

  // Authoritatively consume a quote when a ride is booked
  validateAndConsumeQuote(quoteId, selectedCategoryId) {
    if (!quoteId) {
      throw new Error('Missing quote identifier. Real-time pricing quote required.');
    }

    const quote = this.activeQuotes.get(quoteId);
    if (!quote) {
      throw new Error('Fare quote expired or not found. Please recalculate your route.');
    }

    if (Date.now() > quote.expiresAt) {
      this.activeQuotes.delete(quoteId);
      throw new Error('Price quote has expired. Fares refreshed to reflect current road conditions.');
    }

    const tierQuote = quote.tiers[selectedCategoryId];
    if (!tierQuote) {
      throw new Error(`Vehicle category '${selectedCategoryId}' is not available in quote ${quoteId}.`);
    }

    return {
      quoteId: quote.quoteId,
      versionId: quote.versionId,
      tier: tierQuote,
      selectedCategoryId,
      roadDistanceKm: quote.roadDistanceKm,
      distanceKm: quote.roadDistanceKm,
      durationMins: quote.estimatedDurationMinutes,
      routingProvider: quote.routingProvider,
      routeGeometry: quote.routeGeometry,
      pickup: quote.pickup,
      destination: quote.destination
    };
  }
}

module.exports = new PricingService();
