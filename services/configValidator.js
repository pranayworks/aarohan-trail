// ============================================================================
// AAROHAN PRODUCTION CONFIGURATION VALIDATOR • LILONGWE, MALAWI
// ============================================================================
// Enforces:
//   1. Strict fail-fast startup checks when NODE_ENV === 'production'
//   2. Rejects missing, short, or placeholder keys for:
//      - JWT_SECRET (>= 32 chars)
//      - OTP_HMAC_SECRET (>= 16 chars)
//      - DATABASE_URL (valid PostgreSQL connection string)
//      - SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY (>= 20 chars)
//   3. NEVER prints secret values to console or error messages
// ============================================================================

const SUBSTRING_PLACEHOLDERS = [
  'change-me',
  'changeme',
  'placeholder',
  'your-secret',
  'your_secret',
  'your-service-role-key',
  'your-supabase-key',
  'your-project',
  'test_secret',
  'dev_secret',
  'replace_me',
  'replace-me',
  'replaceme'
];

const EXACT_PLACEHOLDERS = [
  'secret',
  'default',
  'todo',
  'example',
  'xxx',
  '12345678',
  'admin123'
];

function isKnownPlaceholder(val) {
  if (!val || typeof val !== 'string') return false;
  const lower = val.trim().toLowerCase();
  for (const ph of SUBSTRING_PLACEHOLDERS) {
    if (lower.includes(ph)) return true;
  }
  for (const ph of EXACT_PLACEHOLDERS) {
    if (lower === ph) return true;
  }
  return false;
}

function validateStartupConfig(env = process.env, enforceProduction = false) {
  const isProd = enforceProduction || env.NODE_ENV === 'production';
  if (!isProd) {
    return { valid: true };
  }

  const errors = [];

  // 1. JWT_SECRET
  const jwt = env.JWT_SECRET;
  if (!jwt || typeof jwt !== 'string' || !jwt.trim()) {
    errors.push('JWT_SECRET is missing.');
  } else if (jwt.trim().length < 32) {
    errors.push('JWT_SECRET is too short (minimum 32 characters required).');
  } else if (isKnownPlaceholder(jwt)) {
    errors.push('JWT_SECRET uses an insecure placeholder.');
  }

  // 2. OTP_HMAC_SECRET
  const otpHmac = env.OTP_HMAC_SECRET;
  if (!otpHmac || typeof otpHmac !== 'string' || !otpHmac.trim()) {
    errors.push('OTP_HMAC_SECRET is missing.');
  } else if (otpHmac.trim().length < 16) {
    errors.push('OTP_HMAC_SECRET is too short (minimum 16 characters required).');
  } else if (isKnownPlaceholder(otpHmac)) {
    errors.push('OTP_HMAC_SECRET uses an insecure placeholder.');
  }

  // 3. DATABASE_URL
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl || typeof dbUrl !== 'string' || !dbUrl.trim()) {
    errors.push('DATABASE_URL is missing.');
  } else if (dbUrl.trim().length < 15) {
    errors.push('DATABASE_URL is too short.');
  } else if (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection URL.');
  } else if (isKnownPlaceholder(dbUrl)) {
    errors.push('DATABASE_URL contains a placeholder host or credentials.');
  }

  // 4. SUPABASE_SECRET_KEY
  const supabaseKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey || typeof supabaseKey !== 'string' || !supabaseKey.trim()) {
    errors.push('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) is missing.');
  } else if (supabaseKey.trim().length < 20) {
    errors.push('SUPABASE_SECRET_KEY is too short (minimum 20 characters required).');
  } else if (isKnownPlaceholder(supabaseKey)) {
    errors.push('SUPABASE_SECRET_KEY uses an insecure placeholder.');
  }

  // 4b. Email login mode needs a real email provider (a simulator would send nothing in production)
  if (String(env.AUTH_MODE || '').trim().toLowerCase() === 'email') {
    const prov = String(env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const keyName = prov === 'brevo' ? 'BREVO_API_KEY' : (prov === 'resend' ? 'RESEND_API_KEY' : null);
    if (!keyName) {
      errors.push('AUTH_MODE=email requires EMAIL_PROVIDER to be brevo or resend.');
    } else if (!env[keyName] || String(env[keyName]).trim().length < 16) {
      errors.push(`AUTH_MODE=email with EMAIL_PROVIDER=${prov} requires ${keyName}.`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(env.EMAIL_FROM_ADDRESS || '').trim())) {
      errors.push('AUTH_MODE=email requires EMAIL_FROM_ADDRESS (the verified sender address).');
    }
  }

  // 5a. SOS alerts need a confirmed security desk number (no silent default)
  const desk = (env.AAROHAN_SECURITY_DESK_PHONE || '').trim();
  if (!/^\+265\d{9}$/.test(desk)) {
    errors.push('AAROHAN_SECURITY_DESK_PHONE must be set to a real +265 number that staff answer 24/7.');
  } else if (desk === '+265991234567') {
    errors.push('AAROHAN_SECURITY_DESK_PHONE must not be the demo rider number (+265991234567).');
  }

  // 5b. Test-only variables must never exist in production
  if (env.DATABASE_URL_TEST && String(env.DATABASE_URL_TEST).trim()) {
    errors.push('DATABASE_URL_TEST must not be set in production.');
  }
  if (env.TEST_DB_PROJECT_REF && String(env.TEST_DB_PROJECT_REF).trim()) {
    errors.push('TEST_DB_PROJECT_REF must not be set in production.');
  }

  if (errors.length > 0) {
    const message = `FATAL: Production startup refused due to configuration errors:\n - ${errors.join('\n - ')}`;
    throw new Error(message);
  }

  return { valid: true };
}

module.exports = {
  validateStartupConfig,
  isKnownPlaceholder
};
