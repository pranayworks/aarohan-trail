// ============================================================================
// Aarohan email sender (used for login codes when AUTH_MODE=email)
// Providers: brevo | resend | simulator.   Zero-cost options: Brevo free plan, Resend free plan.
// The code is never logged, except by the development simulator.
// ============================================================================

const { isProduction } = require('./featureFlags');

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`;
}

const provider = () => String(process.env.EMAIL_PROVIDER || 'simulator').trim().toLowerCase();
const fromAddress = () => String(process.env.EMAIL_FROM_ADDRESS || '').trim();
const fromName = () => String(process.env.EMAIL_FROM_NAME || 'Aarohan').trim();

async function postJson(url, headers, body, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      // Keep only a short error code/message so a failure can be diagnosed. Email addresses are masked
      // and the raw response body is never included.
      let detail = '';
      try {
        const body = JSON.parse(await res.text());
        const code = typeof body.code === 'string' && /^[\w.-]{1,40}$/.test(body.code) ? body.code : '';
        const msg = typeof body.message === 'string' ? body.message.replace(/[^\s@]+@[^\s@]+/g, '<email>').slice(0, 140) : '';
        detail = [code, msg].filter(Boolean).join(': ');
      } catch (_) { /* not JSON: status only */ }
      throw new Error(`Email provider responded with status ${res.status}${detail ? ` (${detail})` : ''}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function deliverEmail({ to, subject, text, html }) {
  const p = provider();

  if (p === 'brevo') {
    const key = process.env.BREVO_API_KEY;
    if (!key || !fromAddress()) throw new Error('Brevo is not configured (BREVO_API_KEY and EMAIL_FROM_ADDRESS).');
    await postJson('https://api.brevo.com/v3/smtp/email', { 'api-key': key }, {
      sender: { name: fromName(), email: fromAddress() },
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html
    });
    return { provider: 'brevo' };
  }

  if (p === 'resend') {
    const key = process.env.RESEND_API_KEY;
    if (!key || !fromAddress()) throw new Error('Resend is not configured (RESEND_API_KEY and EMAIL_FROM_ADDRESS).');
    await postJson('https://api.resend.com/emails', { Authorization: `Bearer ${key}` }, {
      from: `${fromName()} <${fromAddress()}>`,
      to: [to],
      subject,
      text,
      html
    });
    return { provider: 'resend' };
  }

  if (p === 'simulator') {
    // In production a simulator would silently "send" nothing, so refuse instead.
    if (isProduction()) throw new Error('EMAIL_PROVIDER must be brevo or resend in production.');
    return { provider: 'simulator' };
  }

  throw new Error(`Unknown EMAIL_PROVIDER "${p}".`);
}

// Sends the email and records it in the message log (address masked, body never stored).
async function sendEmail({ to, subject, text, html, purpose, userId }) {
  const messageLog = require('./messageLog');
  try {
    const r = await deliverEmail({ to, subject, text, html });
    await messageLog.log({ channel: 'EMAIL', purpose, to, userId, subject, status: r.provider === 'simulator' ? 'SIMULATED' : 'SENT', provider: r.provider });
    return r;
  } catch (e) {
    await messageLog.log({ channel: 'EMAIL', purpose, to, userId, subject, status: 'FAILED', provider: provider(), error: e.message });
    throw e;
  }
}

async function sendOtpEmail({ to, code }) {
  const subject = 'Your Aarohan verification code';
  const text =
    `Your Aarohan verification code is ${code}.\n` +
    `It expires in 5 minutes. Do not share it with anyone.\n\n` +
    `If you did not ask for this code, you can ignore this email.`;
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:420px;margin:auto;padding:24px;background:#0B0B0B;color:#fff;border-radius:16px">` +
    `<h2 style="margin:0 0 8px;color:#FF6A00">Aarohan</h2>` +
    `<p style="margin:0 0 16px;color:#A3A3A3">Your verification code</p>` +
    `<p style="font-size:34px;letter-spacing:8px;font-weight:800;margin:0 0 16px">${code}</p>` +
    `<p style="margin:0;color:#A3A3A3;font-size:13px">It expires in 5 minutes. Do not share it with anyone. If you did not ask for this code, ignore this email.</p>` +
    `</div>`;

  const result = await sendEmail({ to, subject, text, html, purpose: 'LOGIN_CODE' });

  // Development only: print the code so the app can be tested without sending real email.
  if (result.provider === 'simulator' && process.env.NODE_ENV === 'development') {
    console.log(`[DEV EMAIL OTP] ${to} : ${code}`);
  }
  return result;
}

module.exports = { maskEmail, sendEmail, sendOtpEmail };
