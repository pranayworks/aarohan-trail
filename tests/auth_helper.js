// ============================================================================
// AAROHAN TEST AUTHENTICATION HELPER • LILONGWE, MALAWI
// ============================================================================
// Provides signed JWT tokens for test fixtures across all test suites.
// ============================================================================

require('dotenv').config();
const jwt = require('jsonwebtoken');

// Ensure secrets exist for tests even if .env is missing them in headless run
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'aarohan-development-jwt-secret-min-32-chars-ok-key!';
}
if (!process.env.OTP_HMAC_SECRET || process.env.OTP_HMAC_SECRET.length < 16) {
  process.env.OTP_HMAC_SECRET = 'aarohan-development-otp-hmac-server-secret-ok!';
}

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Generate a valid signed JWT for test users
 */
function getTestToken({ userId, role = 'RIDER', driverId = null, phone = '+265991234567', name = 'Test User' } = {}) {
  let effectiveUserId = userId;
  let effectiveDriverId = driverId;

  if (!effectiveUserId) {
    if (role === 'ADMIN') {
      effectiveUserId = 'a3c3e323-74b8-4aa7-89da-7548be4badcd';
    } else if (role === 'DRIVER') {
      effectiveUserId = 'c85a4d20-dbb6-45ec-8e45-3b60b56fc714';
      if (!effectiveDriverId) effectiveDriverId = '80cb5739-2a60-4fef-a698-88ec2df37dae';
    } else {
      effectiveUserId = '522b4c2a-eae5-436d-ac1c-73fd3a2ad3c0';
    }
  }

  const payload = {
    userId: effectiveUserId,
    phone,
    role,
    driverId: effectiveDriverId,
    name
  };

  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h'
  });
}

module.exports = {
  getTestToken,
  JWT_SECRET
};
