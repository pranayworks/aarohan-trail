-- ============================================================================
-- GAMAN RIDE-HAILING PLATFORM • LILONGWE, MALAWI
-- SUPABASE POSTGRESQL FINANCIAL LEDGER & PRICING ENGINE SCHEMA MIGRATION
-- ============================================================================
-- Features:
--   1. Configurable Vehicle Pricing & Multi-Version Pricing Engine
--   2. Authoritative Road Route Snapshots & Immutable Fare Quotes
--   3. Transparent Ride Fare Breakdowns with Documented Order of Operations
--   4. 30% Gaman Platform Commission & 70% Driver Share Accounting
--   5. Cash Gross Collection vs Commission Debt Ledger
--   6. Digital Escrow Holding & Idempotent Payouts
--   7. Full Double-Entry Financial Ledger with Reversals & Audit Logs
--   8. Supabase Row Level Security (RLS) for Riders, Drivers, and Admins
-- ============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. PRICING VERSIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_versions (
    version_id VARCHAR(64) PRIMARY KEY,
    version_name VARCHAR(128) NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    currency VARCHAR(8) NOT NULL DEFAULT 'MWK',
    default_commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.3000, -- 30% Gaman
    default_driver_share_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.7000, -- 70% Driver
    rounding_policy VARCHAR(32) NOT NULL DEFAULT 'NEAREST_50',
    created_by VARCHAR(64) NOT NULL DEFAULT 'ADMIN_SUPER',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_versions_active ON pricing_versions(is_active);

-- ----------------------------------------------------------------------------
-- 2. VEHICLE PRICING RULES (Per Category: moto, auto, cab)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_pricing_rules (
    rule_id VARCHAR(64) PRIMARY KEY,
    version_id VARCHAR(64) NOT NULL REFERENCES pricing_versions(version_id) ON DELETE CASCADE,
    category_id VARCHAR(32) NOT NULL, -- 'moto', 'auto', 'cab'
    category_name VARCHAR(64) NOT NULL,
    base_fare INTEGER NOT NULL CHECK (base_fare >= 0),
    price_per_km INTEGER NOT NULL CHECK (price_per_km >= 0),
    price_per_minute INTEGER NOT NULL CHECK (price_per_minute >= 0),
    minimum_fare INTEGER NOT NULL CHECK (minimum_fare >= base_fare),
    booking_fee INTEGER NOT NULL DEFAULT 0 CHECK (booking_fee >= 0),
    waiting_charge_per_min INTEGER NOT NULL DEFAULT 0,
    free_waiting_minutes INTEGER NOT NULL DEFAULT 3,
    cancellation_fee INTEGER NOT NULL DEFAULT 1000,
    demand_multiplier_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    default_demand_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
    commission_rate_override NUMERIC(5, 4), -- NULL uses default 30%
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_version_category UNIQUE (version_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_pricing_rules_cat ON vehicle_pricing_rules(category_id);

-- ----------------------------------------------------------------------------
-- 3. FARE QUOTES (Immutable Snapshots from Mapbox Directions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fare_quotes (
    quote_id VARCHAR(64) PRIMARY KEY,
    version_id VARCHAR(64) NOT NULL REFERENCES pricing_versions(version_id),
    rider_id VARCHAR(64),
    pickup_lat NUMERIC(9, 6) NOT NULL,
    pickup_lng NUMERIC(9, 6) NOT NULL,
    pickup_address TEXT,
    dropoff_lat NUMERIC(9, 6) NOT NULL,
    dropoff_lng NUMERIC(9, 6) NOT NULL,
    dropoff_address TEXT,
    road_distance_km NUMERIC(6, 2) NOT NULL CHECK (road_distance_km >= 0),
    estimated_duration_minutes INTEGER NOT NULL CHECK (estimated_duration_minutes >= 0),
    routing_provider VARCHAR(32) NOT NULL DEFAULT 'mapbox',
    route_polyline TEXT,
    demand_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
    is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fare_quotes_expires ON fare_quotes(expires_at);

-- ----------------------------------------------------------------------------
-- 4. RIDE FARE BREAKDOWNS (Authoritative Itemized Calculation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ride_fare_breakdowns (
    breakdown_id VARCHAR(64) PRIMARY KEY,
    ride_id VARCHAR(64) NOT NULL UNIQUE,
    quote_id VARCHAR(64) REFERENCES fare_quotes(quote_id),
    version_id VARCHAR(64) NOT NULL REFERENCES pricing_versions(version_id),
    category_id VARCHAR(32) NOT NULL,
    
    -- Fare Components
    base_fare INTEGER NOT NULL,
    distance_charge INTEGER NOT NULL,
    time_charge INTEGER NOT NULL,
    booking_fee INTEGER NOT NULL DEFAULT 0,
    waiting_charge INTEGER NOT NULL DEFAULT 0,
    surge_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.00,
    discount_amount INTEGER NOT NULL DEFAULT 0,
    
    -- Subtotals & Commission Base
    gross_fare INTEGER NOT NULL, -- Total passenger ride fare
    eligible_commission_base INTEGER NOT NULL, -- Component subject to 30% Gaman fee
    commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.3000, -- 0.3000 (30%)
    commission_amount INTEGER NOT NULL, -- Gaman 30% commission
    driver_share INTEGER NOT NULL, -- Driver 70% share of eligible fare
    
    -- Explicitly Non-Commission Items
    driver_tip INTEGER NOT NULL DEFAULT 0, -- 100% to Driver
    cancellation_fee INTEGER NOT NULL DEFAULT 0,
    tolls_and_taxes INTEGER NOT NULL DEFAULT 0,
    payment_provider_fee INTEGER NOT NULL DEFAULT 0,
    
    -- Net Totals
    total_passenger_paid INTEGER NOT NULL,
    total_driver_net_earnings INTEGER NOT NULL, -- driver_share + driver_tip
    
    currency VARCHAR(8) NOT NULL DEFAULT 'MWK',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ride_breakdowns_ride ON ride_fare_breakdowns(ride_id);

-- ----------------------------------------------------------------------------
-- 5. COMMISSION LEDGER (Gaman 30% Platform Obligations & Collections)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commission_ledger (
    entry_id VARCHAR(64) PRIMARY KEY,
    ride_id VARCHAR(64) NOT NULL REFERENCES ride_fare_breakdowns(ride_id),
    driver_id VARCHAR(64) NOT NULL,
    eligible_fare INTEGER NOT NULL,
    commission_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.3000,
    commission_amount INTEGER NOT NULL,
    payment_method VARCHAR(32) NOT NULL, -- 'CASH', 'AIRTEL_MONEY', 'TNM_MPAMBA', 'CARD'
    settlement_status VARCHAR(32) NOT NULL, 
    -- 'PENDING_CASH_SETTLEMENT' (for cash rides where driver collected gross)
    -- 'DEDUCTED_DIGITAL_ESCROW' (automatically withheld from mobile money payout)
    -- 'SETTLED' (cash commission paid by driver and verified by admin)
    -- 'WAIVED' (support resolution waiver)
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    settled_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_driver ON commission_ledger(driver_id);
CREATE INDEX IF NOT EXISTS idx_commission_status ON commission_ledger(settlement_status);

-- ----------------------------------------------------------------------------
-- 6. DRIVER EARNINGS LEDGER (70% Share + 100% Tips + Balance Accounting)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_earnings_ledger (
    entry_id VARCHAR(64) PRIMARY KEY,
    ride_id VARCHAR(64) NOT NULL REFERENCES ride_fare_breakdowns(ride_id),
    driver_id VARCHAR(64) NOT NULL,
    gross_fare INTEGER NOT NULL,
    commission_amount INTEGER NOT NULL,
    driver_net_share INTEGER NOT NULL,
    driver_tip INTEGER NOT NULL DEFAULT 0,
    total_driver_earned INTEGER NOT NULL,
    payment_method VARCHAR(32) NOT NULL,
    collection_mode VARCHAR(32) NOT NULL,
    -- 'CASH_IN_HAND' (driver kept full cash, owes commission)
    -- 'DIGITAL_ESCROW' (held by Gaman, payable via mobile money payout)
    payout_status VARCHAR(32) NOT NULL DEFAULT 'AVAILABLE',
    -- 'AVAILABLE' (ready for payout)
    -- 'PAID_OUT' (transferred via Airtel Money / TNM Mpamba)
    -- 'CASH_RETAINED' (already in driver's pocket)
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_earnings_driver ON driver_earnings_ledger(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_earnings_payout ON driver_earnings_ledger(payout_status);

-- ----------------------------------------------------------------------------
-- 7. PAYMENT TRANSACTIONS (Rider Mobile Money / Digital Collections)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY,
    ride_id VARCHAR(64) NOT NULL,
    rider_id VARCHAR(64) NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'MWK',
    payment_method VARCHAR(32) NOT NULL, -- 'AIRTEL_MONEY', 'TNM_MPAMBA', 'CARD', 'CASH'
    provider VARCHAR(32) NOT NULL, -- 'airtel', 'tnm', 'paychangu', 'cash'
    provider_reference VARCHAR(128),
    status VARCHAR(32) NOT NULL, -- 'PENDING', 'SUCCESS', 'FAILED', 'REVERSED', 'EXPIRED'
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_status ON payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_tx_ref ON payment_transactions(provider_reference);

-- ----------------------------------------------------------------------------
-- 8. DRIVER PAYOUT TRANSACTIONS (70% Earnings Mobile Money Disbursements)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payout_transactions (
    payout_id VARCHAR(64) PRIMARY KEY,
    driver_id VARCHAR(64) NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'MWK',
    provider VARCHAR(32) NOT NULL, -- 'airtel_money', 'tnm_mpamba'
    destination_phone VARCHAR(32) NOT NULL,
    provider_reference VARCHAR(128),
    fee_amount INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'SUCCESS', 'FAILED'
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    error_message TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_tx_driver ON payout_transactions(driver_id);
CREATE INDEX IF NOT EXISTS idx_payout_tx_status ON payout_transactions(status);

-- ----------------------------------------------------------------------------
-- 9. CASH COMMISSION SETTLEMENTS (Driver Cash Remittances to Gaman)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_commission_settlements (
    settlement_id VARCHAR(64) PRIMARY KEY,
    driver_id VARCHAR(64) NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency VARCHAR(8) NOT NULL DEFAULT 'MWK',
    remittance_method VARCHAR(32) NOT NULL, -- 'AIRTEL_BUSINESS_TILL', 'BANK_DEPOSIT', 'HQ_CASH_DESK'
    remittance_reference VARCHAR(128),
    verified_by_admin VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION', -- 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'
    notes TEXT,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_settle_driver ON cash_commission_settlements(driver_id);
CREATE INDEX IF NOT EXISTS idx_cash_settle_status ON cash_commission_settlements(status);

-- ----------------------------------------------------------------------------
-- 10. FINANCIAL ADJUSTMENTS & REVERSALS (Disputes, Refunds & Waivers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_adjustments (
    adjustment_id VARCHAR(64) PRIMARY KEY,
    reference_type VARCHAR(32) NOT NULL, -- 'RIDE', 'COMMISSION', 'DRIVER_PAYOUT'
    reference_id VARCHAR(64) NOT NULL,
    amount INTEGER NOT NULL, -- Negative for debit, positive for credit
    adjustment_type VARCHAR(32) NOT NULL, -- 'REFUND', 'DISPUTE_CORRECTION', 'COMMISSION_WAIVER'
    reason TEXT NOT NULL,
    authorized_by VARCHAR(64) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 11. FINANCIAL AUDIT LOGS (Immutable Security & Pricing Audit Trail)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_audit_logs (
    log_id VARCHAR(64) PRIMARY KEY DEFAULT ('LOG-' || substr(md5(random()::text), 1, 12)),
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON financial_audit_logs(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
ALTER TABLE pricing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fare_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_fare_breakdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_earnings_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_commission_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Public / Authenticated read access for active pricing rules
CREATE POLICY "Public read active pricing" ON pricing_versions
    FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Public read vehicle pricing rules" ON vehicle_pricing_rules
    FOR SELECT USING (TRUE);

-- 2. Riders can read their own quotes and breakdowns
CREATE POLICY "Riders read own quotes" ON fare_quotes
    FOR SELECT USING (auth.uid()::text = rider_id);

CREATE POLICY "Riders read own ride breakdowns" ON ride_fare_breakdowns
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM fare_quotes 
            WHERE fare_quotes.quote_id = ride_fare_breakdowns.quote_id 
            AND fare_quotes.rider_id = auth.uid()::text
        )
    );

-- 3. Drivers can read only their own earnings and payout records
CREATE POLICY "Drivers read own earnings" ON driver_earnings_ledger
    FOR SELECT USING (auth.uid()::text = driver_id);

CREATE POLICY "Drivers read own payouts" ON payout_transactions
    FOR SELECT USING (auth.uid()::text = driver_id);

CREATE POLICY "Drivers read own commission obligation" ON commission_ledger
    FOR SELECT USING (auth.uid()::text = driver_id);

CREATE POLICY "Drivers read own cash settlements" ON cash_commission_settlements
    FOR SELECT USING (auth.uid()::text = driver_id);

-- 4. Admin full control policy (checked via user role claim)
CREATE POLICY "Admin full access pricing" ON pricing_versions
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access vehicle rules" ON vehicle_pricing_rules
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access breakdowns" ON ride_fare_breakdowns
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access commission ledger" ON commission_ledger
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access driver earnings" ON driver_earnings_ledger
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access payments" ON payment_transactions
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access payouts" ON payout_transactions
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access settlements" ON cash_commission_settlements
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin full access adjustments" ON financial_adjustments
    FOR ALL USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admin read audit logs" ON financial_audit_logs
    FOR SELECT USING (auth.jwt() ->> 'role' = 'admin');

-- ============================================================================
-- SEED INITIAL ACTIVE PRICING VERSION (v1.0.0-Lilongwe)
-- ============================================================================
INSERT INTO pricing_versions (
    version_id, version_name, effective_from, is_active, currency, 
    default_commission_rate, default_driver_share_rate, rounding_policy, notes
) VALUES (
    'GMN-PRICE-V1',
    'Lilongwe Standard Urban Mobility Tariffs 2026',
    NOW(),
    TRUE,
    'MWK',
    0.3000, -- 30% Gaman Commission
    0.7000, -- 70% Driver Share
    'NEAREST_50',
    'Initial verified launch rates with 30/70 split for Lilongwe capital district'
) ON CONFLICT (version_id) DO NOTHING;

-- Seed Rules for Motorcycle (Moto), Tuk-Tuk (Auto), and Cab (Car)
INSERT INTO vehicle_pricing_rules (
    rule_id, version_id, category_id, category_name, base_fare, price_per_km, price_per_minute, 
    minimum_fare, booking_fee, waiting_charge_per_min, free_waiting_minutes, cancellation_fee,
    demand_multiplier_enabled, default_demand_multiplier
) VALUES
(
    'RULE-V1-MOTO', 'GMN-PRICE-V1', 'moto', 'Gaman Moto', 
    800, 250, 40, 1200, 150, 30, 3, 500, FALSE, 1.00
),
(
    'RULE-V1-AUTO', 'GMN-PRICE-V1', 'auto', 'Gaman Auto', 
    1400, 450, 60, 2200, 200, 50, 3, 800, FALSE, 1.00
),
(
    'RULE-V1-CAB', 'GMN-PRICE-V1', 'cab', 'Gaman Cab', 
    2800, 850, 120, 4500, 300, 80, 5, 1500, FALSE, 1.00
)
ON CONFLICT (version_id, category_id) DO NOTHING;
