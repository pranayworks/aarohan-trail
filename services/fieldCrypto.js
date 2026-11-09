// ============================================================================
// Field-level encryption for the most sensitive identity data (AES-256-GCM) plus a keyed hash so the
// same ID or licence cannot be registered twice. Key: KYC_ENCRYPTION_KEY (base64 of 32 random bytes).
// In production there is NO fallback: without the key we refuse to store identity data.
// Create a key with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// ============================================================================
const crypto = require('crypto');

function key() {
  const raw = process.env.KYC_ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('KYC_ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
    return k;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('KYC_ENCRYPTION_KEY is required in production.');
  // Development only: derive a key so local work does not need setup.
  return crypto.createHash('sha256').update('dev-only:' + (process.env.JWT_SECRET || 'aarohan')).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(blob) {
  const [v, iv, tag, data] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Unknown encrypted value format.');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// Same input always gives the same hash (for duplicate detection), but it cannot be reversed without the key.
const fingerprint = (plain) => crypto.createHmac('sha256', key()).update(String(plain).trim().toUpperCase().replace(/[\s-]/g, '')).digest('hex');
const last4 = (plain) => String(plain).replace(/[\s-]/g, '').slice(-4);

module.exports = { encrypt, decrypt, fingerprint, last4 };
