// ============================================================================
// The commission limit. Cash trips: the driver keeps the cash and owes Aarohan its share.
// When what they owe REACHES the limit, they stop getting orders until they pay.
// Set MAX_COMMISSION_DEBT_MWK in .env to change it (default MK 2,500).
// ============================================================================
const DEFAULT_LIMIT_MWK = 2500;
const limitMWK = () => parseInt(process.env.MAX_COMMISSION_DEBT_MWK, 10) || DEFAULT_LIMIT_MWK;
const reached = (debt) => Number(debt || 0) >= limitMWK();
const warnAtMWK = () => Math.floor(limitMWK() * 0.8);
module.exports = { limitMWK, reached, warnAtMWK, DEFAULT_LIMIT_MWK };
