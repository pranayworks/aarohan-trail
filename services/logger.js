// ============================================================================
// AAROHAN STRUCTURED LOGGER • LILONGWE, MALAWI
// ============================================================================
// Enforces:
//   1. Structured JSON or formatted console logging
//   2. Strict redaction: NEVER logs OTPs, tokens, or phone numbers in full
//   3. Express HTTP middleware with request sanitization
// ============================================================================

/**
 * Masks phone numbers to +265***XXXX format (e.g. +265991234567 -> +265***4567)
 */
function maskPhoneNumber(phone) {
  if (typeof phone !== 'string') return phone;
  // Match Malawian or standard E.164 phone
  return phone.replace(/(\+?265|\+?\d{1,3})[\s-]?(\d{2,3})[\s-]?(\d{3})[\s-]?(\d{3,4})/g, (match, country) => {
    const digitsOnly = match.replace(/\D/g, '');
    const last4 = digitsOnly.slice(-4);
    return `+${country.replace(/\D/g, '')}***${last4}`;
  });
}

/**
 * Redacts JWT tokens, refresh tokens, passwords, and OTP codes
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;

  let sanitized = str;

  // 1. Redact Bearer JWT tokens (eyJ...)
  sanitized = sanitized.replace(/(Bearer\s+)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, '$1eyJ***[REDACTED_TOKEN]');
  sanitized = sanitized.replace(/("token"\s*:\s*")eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(")/gi, '$1eyJ***[REDACTED_TOKEN]$2');
  sanitized = sanitized.replace(/(token=)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, '$1eyJ***[REDACTED_TOKEN]');

  // 2. Redact OTP codes (patterns like "otp": "123456", "code": "123456", [DEV OTP] ... : 123456)
  sanitized = sanitized.replace(/(otp(?:code)?["':\s=]+)(\d{4,8})/gi, '$1[REDACTED_OTP]');
  sanitized = sanitized.replace(/(code["':\s=]+)(\d{6})/gi, '$1[REDACTED_OTP]');
  sanitized = sanitized.replace(/(\[DEV OTP\][^\n:]+:\s*)(\d{6})/gi, '$1[REDACTED_OTP]');

  // 3. Redact passwords / secrets
  sanitized = sanitized.replace(/(password(?:Hash)?["':\s=]+)[^\s",}]+/gi, '$1[REDACTED]');
  sanitized = sanitized.replace(/(secret["':\s=]+)[^\s",}]+/gi, '$1[REDACTED]');

  // 4. Mask phone numbers
  sanitized = maskPhoneNumber(sanitized);

  return sanitized;
}

/**
 * Recursively sanitizes objects and arrays
 */
function sanitizeData(data, depth = 0) {
  if (depth > 6) return '[MAX_DEPTH]';
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item, depth + 1));
  }

  if (typeof data === 'object') {
    const clean = {};
    for (const key of Object.keys(data)) {
      const lower = key.toLowerCase();
      if (lower.includes('otp') || lower === 'code' || lower === 'pin') {
        clean[key] = '[REDACTED_OTP]';
      } else if (lower.includes('token') || lower === 'authorization') {
        clean[key] = '[REDACTED_TOKEN]';
      } else if (lower.includes('password') || lower.includes('secret')) {
        clean[key] = '[REDACTED]';
      } else if (lower.includes('phone')) {
        clean[key] = typeof data[key] === 'string' ? maskPhoneNumber(data[key]) : data[key];
      } else {
        clean[key] = sanitizeData(data[key], depth + 1);
      }
    }
    return clean;
  }

  return data;
}

class Logger {
  formatMessage(level, message, meta) {
    const timestamp = new Date().toISOString();
    const cleanMsg = typeof message === 'string' ? sanitizeString(message) : sanitizeData(message);
    const cleanMeta = meta !== undefined ? sanitizeData(meta) : undefined;

    if (process.env.NODE_ENV === 'production') {
      return JSON.stringify({
        timestamp,
        level,
        message: cleanMsg,
        ...(cleanMeta && typeof cleanMeta === 'object' ? cleanMeta : { meta: cleanMeta })
      });
    }

    const metaStr = cleanMeta ? ` ${JSON.stringify(cleanMeta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${cleanMsg}${metaStr}`;
  }

  info(message, meta) {
    console.log(this.formatMessage('info', message, meta));
  }

  warn(message, meta) {
    console.warn(this.formatMessage('warn', message, meta));
  }

  error(message, meta) {
    console.error(this.formatMessage('error', message, meta));
  }

  /**
   * Express HTTP Request logging middleware
   */
  httpMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        const statusCode = res.statusCode;
        const level = statusCode >= 500 ? 'error' : (statusCode >= 400 ? 'warn' : 'info');
        
        // Sanitize path query params if any
        const sanitizedUrl = sanitizeString(req.originalUrl || req.url);
        
        this[level](`${req.method} ${sanitizedUrl} ${statusCode} - ${duration}ms`, {
          ip: req.ip,
          method: req.method,
          status: statusCode,
          durationMs: duration
        });
      });
      next();
    };
  }
}

const logger = new Logger();

module.exports = {
  logger,
  maskPhoneNumber,
  sanitizeString,
  sanitizeData
};
