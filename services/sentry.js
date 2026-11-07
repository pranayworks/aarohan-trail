// ============================================================================
// AAROHAN SENTRY ERROR MONITORING & PII SCRUBBING SERVICE
// ============================================================================
// Provides optional server-side error monitoring guarded by SENTRY_DSN.
// Disabled when SENTRY_DSN is empty or not set.
// Implements strict PII scrubbing:
//   - Malawian phone numbers (+265XXXXXXXXX)
//   - OTP verification codes (6-digit tokens)
//   - JWT & Refresh tokens (Bearer auth, token fields)
//   - GPS coordinates (lat, lng, coordinates)
//   - Private document paths (uploads/driver-documents/...)
// ============================================================================

const https = require('https');
const url = require('url');

class SentryService {
  constructor() {
    this.dsn = (process.env.SENTRY_DSN || '').trim();
    this.enabled = Boolean(this.dsn && this.dsn.startsWith('http'));
    this.parsedDsn = null;

    if (this.enabled) {
      try {
        const parsed = new url.URL(this.dsn);
        this.parsedDsn = {
          protocol: parsed.protocol,
          host: parsed.host,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname,
          projectId: parsed.pathname.replace(/^\//, ''),
          publicKey: parsed.username
        };
      } catch (e) {
        this.enabled = false;
        console.warn('[Sentry] Invalid SENTRY_DSN format. Error monitoring disabled.');
      }
    }
  }

  /**
   * Deep recursive scrubber that removes PII from error metadata, stack traces, and request payloads.
   */
  scrubData(val, keyHint = '') {
    if (val === null || val === undefined) return val;

    // Check specific sensitive key names
    const lowerKey = String(keyHint).toLowerCase();
    if (['authorization', 'token', 'refreshtoken', 'accesstoken', 'jwt', 'password', 'passwordhash', 'secret'].includes(lowerKey)) {
      return '[REDACTED_TOKEN]';
    }
    if (['otp', 'otpcode', 'code'].includes(lowerKey)) {
      return '[REDACTED_OTP]';
    }
    if (['lat', 'lng', 'latitude', 'longitude', 'currentlat', 'currentlng'].includes(lowerKey)) {
      return '[REDACTED_COORDINATES]';
    }
    if (['documentpath', 'filepath', 'docpath'].includes(lowerKey)) {
      return '[REDACTED_DOC_PATH]';
    }

    if (typeof val === 'string') {
      let scrubbed = val;
      // 1. Scrub Malawian phone numbers (+265XXXXXXXXX or 0XXXXXXXXX)
      scrubbed = scrubbed.replace(/(?:\+?265|0)\s*(88|89|98|99|90|31)\d{7}/g, '[REDACTED_PHONE]');

      // 2. Scrub JWT tokens
      scrubbed = scrubbed.replace(/Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, 'Bearer [REDACTED_TOKEN]');
      scrubbed = scrubbed.replace(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, '[REDACTED_TOKEN]');

      // 3. Scrub sensitive file and document upload paths
      scrubbed = scrubbed.replace(/(?:uploads[\/\\]driver-documents[\/\\][^\s"'`]+)/g, '[REDACTED_DOC_PATH]');
      scrubbed = scrubbed.replace(/(?:driving_license|national_id|proof_of_residence)_[^\s"'`]+/g, '[REDACTED_DOC_PATH]');

      // 4. Scrub potential GPS coordinate pairs: e.g. -13.9722, 33.7667
      scrubbed = scrubbed.replace(/-?1[34]\.\d{3,8},\s*3[34]\.\d{3,8}/g, '[REDACTED_COORDINATES]');

      return scrubbed;
    }

    if (Array.isArray(val)) {
      return val.map((item) => this.scrubData(item, keyHint));
    }

    if (typeof val === 'object') {
      const scrubbedObj = {};
      for (const [k, v] of Object.entries(val)) {
        scrubbedObj[k] = this.scrubData(v, k);
      }
      return scrubbedObj;
    }

    return val;
  }

  /**
   * Captures an exception and reports it to Sentry if enabled.
   */
  captureException(err, context = {}) {
    if (!this.enabled || !this.parsedDsn) return;

    try {
      const scrubbedContext = this.scrubData(context);
      const scrubbedMessage = this.scrubData(err?.message || String(err));
      const scrubbedStack = this.scrubData(err?.stack || '');

      const payload = {
        event_id: require('crypto').randomBytes(16).toString('hex'),
        timestamp: new Date().toISOString(),
        platform: 'node',
        level: 'error',
        environment: process.env.NODE_ENV || 'development',
        exception: {
          values: [
            {
              type: err?.name || 'Error',
              value: scrubbedMessage,
              stacktrace: { frames: [{ filename: 'server.js', function: 'captureException', context_line: scrubbedStack }] }
            }
          ]
        },
        extra: scrubbedContext
      };

      const body = JSON.stringify(payload);
      const options = {
        hostname: this.parsedDsn.host,
        port: this.parsedDsn.port,
        path: `/api/${this.parsedDsn.projectId}/store/`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=aarohan-sentry/1.0.0, sentry_key=${this.parsedDsn.publicKey}`
        },
        timeout: 3000
      };

      const req = https.request(options, (res) => {
        res.resume(); // consume response data to free up memory
      });
      req.on('error', () => {}); // never crash the host on monitoring failure
      req.write(body);
      req.end();
    } catch (e) {
      // Sentry failure must never impact the application
    }
  }

  /**
   * Express error handling middleware
   */
  expressErrorHandler() {
    return (err, req, res, next) => {
      if (this.enabled) {
        this.captureException(err, {
          url: req.originalUrl,
          method: req.method,
          ip: req.ip,
          headers: req.headers
        });
      }
      next(err);
    };
  }
}

const sentry = new SentryService();

module.exports = sentry;

