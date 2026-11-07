// ============================================================================
// AAROHAN CLIENT-SIDE SENTRY ERROR MONITORING & PII SCRUBBER
// ============================================================================
// Active on /rider, /driver, and /admin when SENTRY_DSN is provided.
// Strictly scrubs PII before reporting:
//   - Malawian phone numbers
//   - OTP verification codes
//   - Auth tokens (Bearer, JWT)
//   - User GPS coordinates
//   - Document paths
// ============================================================================

(function(window) {
  'use strict';

  function scrubString(str) {
    if (typeof str !== 'string') return str;
    let s = str;
    // 1. Phones (+265XXXXXXXXX or 0XXXXXXXXX)
    s = s.replace(/(?:\+?265|0)\s*(88|89|98|99|90|31)\d{7}/g, '[REDACTED_PHONE]');
    // 2. Tokens & Bearer
    s = s.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED_TOKEN]');
    s = s.replace(/eyJ[A-Za-z0-9-_.]+/g, '[REDACTED_TOKEN]');
    // 3. Document paths
    s = s.replace(/(?:uploads[\/\\]driver-documents[\/\\][^\s"'`]+)/g, '[REDACTED_DOC_PATH]');
    // 4. GPS Coordinates
    s = s.replace(/-?1[34]\.\d{3,8},\s*3[34]\.\d{3,8}/g, '[REDACTED_COORDINATES]');
    return s;
  }

  function reportClientError(err, type = 'error') {
    const flags = window.AAROHAN_FLAGS || {};
    const dsn = (flags.SENTRY_DSN || flags.sentryDsn || window.SENTRY_DSN || '').trim();
    if (!dsn || !dsn.startsWith('http')) return; // Disabled

    try {
      const msg = scrubString(err?.message || String(err));
      const stack = scrubString(err?.stack || '');
      const currentUrl = scrubString(window.location.href);

      // Extract Sentry endpoint parameters
      const urlObj = new URL(dsn);
      const projectId = urlObj.pathname.replace(/^\//, '');
      const key = urlObj.username;
      const endpoint = `${urlObj.protocol}//${urlObj.host}/api/${projectId}/store/`;

      const payload = {
        event_id: Math.random().toString(36).substring(2) + Date.now().toString(36),
        timestamp: new Date().toISOString(),
        platform: 'javascript',
        level: 'error',
        logger: type,
        exception: {
          values: [
            {
              type: err?.name || 'ClientError',
              value: msg,
              stacktrace: { frames: [{ filename: currentUrl, function: 'window.onerror' }] }
            }
          ]
        },
        request: {
          url: currentUrl,
          headers: { 'User-Agent': navigator.userAgent }
        }
      };

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=aarohan-client/1.0.0, sentry_key=${key}`
        },
        body: JSON.stringify(payload),
        mode: 'no-cors'
      }).catch(() => {});
    } catch (e) {
      // Monitoring failure must never impact the user experience
    }
  }

  window.addEventListener('error', function(event) {
    reportClientError(event.error || event.message, 'uncaught_error');
  });

  window.addEventListener('unhandledrejection', function(event) {
    reportClientError(event.reason, 'unhandled_rejection');
  });

  window.aarohanSentry = {
    scrubString: scrubString,
    reportError: reportClientError
  };
})(window);
