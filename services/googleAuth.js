// ============================================================================
// Sign in with Google (riders). The browser gets a signed ID token from Google; we ask Google to
// check it, then make sure it was issued for OUR app (GOOGLE_CLIENT_ID), is not expired, and has a
// verified email. We never see the person's Google password.
// New accounts still need a Malawian mobile number, so the first call returns PROFILE_REQUIRED.
// ============================================================================

const prisma = require('../lib/prisma');
const authService = require('./auth');
const emailAuth = require('./emailAuth');
const emailService = require('./email');

const { AuthError } = emailAuth;
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo?id_token=';

const clientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim();
const enabled = () => clientId().length > 10;

// Asks Google to validate the token. Replaceable in tests.
let verifier = async function googleVerify(credential) {
  const res = await fetch(TOKENINFO + encodeURIComponent(credential), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new AuthError('Google could not verify your sign-in. Please try again.', 401);
  return res.json();
};
const setVerifierForTesting = (fn) => { verifier = fn; };

async function readClaims(credential) {
  if (!enabled()) throw new AuthError('Google sign-in is not set up yet.', 503);
  if (typeof credential !== 'string' || credential.length < 50 || credential.length > 4096) throw new AuthError('Invalid Google sign-in.', 400);
  let c;
  try { c = await verifier(credential); } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Could not reach Google. Please try again.', 503);
  }
  const issuerOk = c.iss === 'accounts.google.com' || c.iss === 'https://accounts.google.com';
  const email = emailAuth.normalizeEmail(c.email);
  if (c.aud !== clientId() || !issuerOk) throw new AuthError('This Google sign-in was not meant for Aarohan.', 401);
  if (Number(c.exp) * 1000 < Date.now()) throw new AuthError('Your Google sign-in expired. Please try again.', 401);
  if (!email || String(c.email_verified) !== 'true') throw new AuthError('Your Google email is not verified.', 401);
  return { email, name: typeof c.name === 'string' ? c.name.trim().slice(0, 60) : '' };
}

async function loginWithGoogle({ credential, name, phone, ip = null, userAgent = null }) {
  const claims = await readClaims(credential);

  let user = await prisma.user.findFirst({ where: { email: claims.email }, include: { driverProfile: true, wallet: true } });
  if (user) {
    if (user.status !== 'ACTIVE') throw new AuthError(`Account is ${String(user.status).toLowerCase()}. Access denied.`, 403);
    if (user.role === 'ADMIN') throw new AuthError('Administrative accounts cannot use Google sign-in.', 403);
  } else {
    const cleanName = (typeof name === 'string' && name.trim()) ? name.trim() : claims.name;
    const cleanPhone = emailAuth.normalizeMalawiPhone(phone);
    if (cleanName.length < 2 || cleanName.length > 60 || !authService.validateMalawianPhone(cleanPhone)) {
      const e = new AuthError('Welcome! Please add your name and Malawian mobile number to finish creating your account.', 409, 'PROFILE_REQUIRED');
      e.suggestedName = claims.name;
      throw e;
    }
    if (await prisma.user.findUnique({ where: { phone: cleanPhone } })) throw new AuthError('This mobile number is already registered to another account.', 409, 'PHONE_IN_USE');
    try {
      user = await prisma.user.create({ data: { email: claims.email, phone: cleanPhone, name: cleanName, role: 'RIDER', status: 'ACTIVE' }, include: { driverProfile: true, wallet: true } });
    } catch (err) {
      if (err && err.code === 'P2002') throw new AuthError('This email or mobile number is already registered.', 409);
      throw err;
    }
    await prisma.wallet.create({ data: { userId: user.id, balanceMWK: 0 } });
    await prisma.auditLog.create({
      data: { user: { connect: { id: user.id } }, action: 'USER_REGISTER', entityType: 'USER', entityId: user.id, details: { emailMasked: emailService.maskEmail(claims.email), role: 'RIDER', provider: 'google', phoneVerified: false }, ipAddress: ip }
    });
  }

  const session = await emailAuth.issueSession(user, ip, userAgent);
  return { success: true, ...session, user: emailAuth.publicUser(user) };
}

module.exports = { loginWithGoogle, enabled, clientId, setVerifierForTesting };
