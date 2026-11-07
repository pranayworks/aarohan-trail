// ============================================================================
// Aarohan feature flags (money-safety switches)
// ----------------------------------------------------------------------------
// In production, real payments and driver payouts are OFF unless explicitly
// enabled with PAYMENTS_ENABLED=true / PAYOUTS_ENABLED=true. This keeps the
// cash-only pilot safe: no simulated "successful" payments can ever occur.
// Outside production (development/test) everything stays available.
// ============================================================================

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function flagOn(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function paymentsEnabled(env = process.env) {
  return !isProduction(env) || flagOn(env.PAYMENTS_ENABLED);
}

function payoutsEnabled(env = process.env) {
  return !isProduction(env) || flagOn(env.PAYOUTS_ENABLED);
}

// How people sign in: 'phone' (SMS codes, default) or 'email' (email codes, zero-cost demo mode).
function authMode(env = process.env) {
  return String(env.AUTH_MODE || '').trim().toLowerCase() === 'email' ? 'email' : 'phone';
}

module.exports = { isProduction, paymentsEnabled, payoutsEnabled, authMode };
