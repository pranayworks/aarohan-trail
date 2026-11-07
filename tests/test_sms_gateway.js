// ============================================================================
// AAROHAN SMS PROVIDERS, COST CONTROL & WEBHOOK VERIFICATION SUITE
// ============================================================================
// Verifies:
//   1. Provider Selection (simulator, twilio, africastalking)
//   2. Generic Alphanumeric Sender Name Rejection (max 11 chars, no generic terms)
//   3. Configurable Caps (OTP_DAILY_CAP_PER_PHONE=5, SMS_DAILY_CAP_TOTAL=200, 60s cooldown)
//   4. Twilio Status Callback Signature Validation (HMAC-SHA1 X-Twilio-Signature)
//   5. SmsLog Content Integrity (SHA-256 hash, masked phone, zero code, zero body)
//   6. Failure Handling (Provider failure does NOT mark OTP as sent in DB)
//   7. Admin Test SMS Confirmation & Rate Limiting
// ============================================================================

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const notificationService = require('../services/notifications');
const {
  validateSenderName,
  validateTwilioSignature,
  hashPhoneNumber,
  maskPhoneNumber
} = require('../services/notifications');
const authService = require('../services/auth');

async function runSmsGatewaySuite() {
  console.log('=============================================================');
  console.log('   AAROHAN SMS GATEWAYS, COST CAPS & WEBHOOK SUITE');
  console.log('=============================================================\n');

  let passed = 0;
  let total = 0;

  function report(name, condition, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [PASS] Test ${total}: ${name}`);
      if (details) console.log(`   └─ ${details}`);
    } else {
      console.error(`❌ [FAIL] Test ${total}: ${name}`);
      if (details) console.error(`   └─ ${details}`);
      throw new Error(`Assertion failed: ${name}`);
    }
  }

  // -------------------------------------------------------------------------
  // 1. Provider Selection
  // -------------------------------------------------------------------------
  console.log('--- 1. Testing SMS Provider Selection ---');
  const originalProvider = process.env.SMS_GATEWAY_PROVIDER;

  process.env.SMS_GATEWAY_PROVIDER = 'simulator';
  report('Selects simulator provider', notificationService.getProvider() === 'simulator');

  process.env.SMS_GATEWAY_PROVIDER = 'twilio';
  report('Selects twilio provider', notificationService.getProvider() === 'twilio');

  process.env.SMS_GATEWAY_PROVIDER = 'africastalking';
  report('Selects africastalking provider', notificationService.getProvider() === 'africastalking');

  process.env.SMS_GATEWAY_PROVIDER = 'unknown_vendor';
  report('Falls back to simulator for unknown provider', notificationService.getProvider() === 'simulator');

  process.env.SMS_GATEWAY_PROVIDER = 'simulator';

  // -------------------------------------------------------------------------
  // 2. Generic Alphanumeric Sender Name Rejection & Length Restrictions
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Testing Sender Name Validation ---');
  report('Accepts valid brand sender "Aarohan"', validateSenderName('Aarohan') === 'Aarohan');

  let rejectedOver11 = false;
  try {
    validateSenderName('AarohanExpress'); // 14 chars > 11
  } catch (e) {
    rejectedOver11 = e.message.includes('exceeds the 11-character GSM limit');
  }
  report('Rejects sender name exceeding 11 characters', rejectedOver11);

  const genericNames = ['Verify', 'OTP', 'Info', 'Notify', 'SMS', 'Alert', 'Code'];
  let allGenericRejected = true;
  for (const name of genericNames) {
    try {
      validateSenderName(name);
      allGenericRejected = false;
    } catch (e) {
      if (!e.message.includes('prohibited by telecom regulations')) {
        allGenericRejected = false;
      }
    }
  }
  report('Rejects generic carrier-restricted sender names (Verify, OTP, Info, Notify, SMS, Alert, Code)', allGenericRejected);

  // -------------------------------------------------------------------------
  // 3. Cost Caps: Per-Phone Cap (5), Global Cap (200), and 60-Second Cooldown
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Testing Cost Caps & Cooldown Guards ---');
  authService.resetRateLimitsForTesting();

  // Test per-phone daily cap default (5)
  delete process.env.OTP_DAILY_CAP_PER_PHONE;
  report('Default per-phone daily cap is 5', authService.getOtpDailyCapPerPhone() === 5);

  delete process.env.SMS_DAILY_CAP_TOTAL;
  report('Default platform total daily cap is 200', authService.getSmsDailyCapTotal() === 200);

  const testPhone = '+265991230001';
  // Send 5 OTPs resetting cooldown between each
  for (let i = 1; i <= 5; i++) {
    authService.resetCooldownForTesting(testPhone);
    await authService.requestOtp(testPhone);
  }

  // 6th OTP must be rejected
  authService.resetCooldownForTesting(testPhone);
  let perPhoneBlocked = false;
  try {
    await authService.requestOtp(testPhone);
  } catch (e) {
    perPhoneBlocked = e.message.includes('Daily SMS verification quota (5) exceeded');
  }
  report('Per-phone daily cap blocks 6th request when limit is 5', perPhoneBlocked);

  // Test 60-second cooldown
  authService.resetRateLimitsForTesting();
  const testPhoneCooldown = '+265991230002';
  await authService.requestOtp(testPhoneCooldown);
  let cooldownBlocked = false;
  try {
    await authService.requestOtp(testPhoneCooldown); // Immediate 2nd request
  } catch (e) {
    cooldownBlocked = e.message.includes('Please wait');
  }
  report('60-second cooldown blocks immediate re-request', cooldownBlocked);

  // Test platform-wide daily SMS cap
  authService.resetRateLimitsForTesting();
  process.env.SMS_DAILY_CAP_TOTAL = '2';
  await authService.requestOtp('+265881110001');
  await authService.requestOtp('+265881110002');

  let globalCapBlocked = false;
  try {
    await authService.requestOtp('+265881110003');
  } catch (e) {
    globalCapBlocked = e.message.includes('Platform daily SMS dispatch limit reached');
  }
  report('Platform total SMS cap blocks dispatch when ceiling reached', globalCapBlocked);

  // Verify AuditLog was recorded for total cap exceed
  const capAudit = await prisma.auditLog.findFirst({
    where: { action: 'SMS_CAP_EXCEEDED' },
    orderBy: { createdAt: 'desc' }
  });
  report('Exceeding platform SMS cap writes immutable AuditLog row with action SMS_CAP_EXCEEDED', Boolean(capAudit));

  // Reset rate limits
  authService.resetRateLimitsForTesting();
  delete process.env.SMS_DAILY_CAP_TOTAL;

  // -------------------------------------------------------------------------
  // 4. Twilio Status Callback Webhook Signature Validation
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Testing Twilio Webhook Signature Validation ---');
  const dummyAuthToken = '1234567890abcdef1234567890abcdef';
  const callbackUrl = 'https://aarohan.app/api/notifications/twilio-callback';
  const callbackParams = {
    MessageSid: 'SM1234567890abcdef',
    MessageStatus: 'delivered',
    To: '+265991234567'
  };

  // Calculate valid signature
  let dataToSign = callbackUrl;
  Object.keys(callbackParams).sort().forEach(k => {
    dataToSign += k + callbackParams[k];
  });
  const validSignature = crypto.createHmac('sha1', dummyAuthToken).update(Buffer.from(dataToSign, 'utf8')).digest('base64');

  report('Twilio signature validator approves authentic signature', validateTwilioSignature({
    authToken: dummyAuthToken,
    signature: validSignature,
    url: callbackUrl,
    params: callbackParams
  }));

  report('Twilio signature validator rejects spoofed signature', !validateTwilioSignature({
    authToken: dummyAuthToken,
    signature: 'bad-signature-base64',
    url: callbackUrl,
    params: callbackParams
  }));

  report('Twilio signature validator rejects altered payload parameters', !validateTwilioSignature({
    authToken: dummyAuthToken,
    signature: validSignature,
    url: callbackUrl,
    params: { ...callbackParams, MessageStatus: 'failed' }
  }));

  // -------------------------------------------------------------------------
  // 5. SmsLog Content Integrity: Zero Raw Code, Zero Full Phone, Zero Body
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Testing SmsLog Database Schema & Data Privacy ---');
  const loggedPhone = '+265997654321';
  const sendRes = await notificationService.sendSms({
    to: loggedPhone,
    message: 'Your Aarohan verification code is 482910. It expires in 5 minutes. Do not share it.',
    purpose: 'OTP',
    codeForDevLog: '482910'
  });

  const smsLogRow = await prisma.smsLog.findUnique({
    where: { id: sendRes.logId }
  });

  report('SmsLog record exists in database', Boolean(smsLogRow));
  report('SmsLog stores SHA-256 phoneHash instead of raw phone', smsLogRow.phoneHash === hashPhoneNumber(loggedPhone));
  report('SmsLog stores masked phone number (+26599****321)', smsLogRow.phoneMasked === maskPhoneNumber(loggedPhone) && !smsLogRow.phoneMasked.includes('7654'));
  report('SmsLog contains zero message body column', smsLogRow.message === undefined && smsLogRow.body === undefined);
  report('SmsLog contains zero OTP code column', smsLogRow.code === undefined && smsLogRow.otp === undefined);

  // -------------------------------------------------------------------------
  // 6. Failure Handling: Provider Failure Does NOT Save OTP in Database
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Testing Failure Handling & Rollback Invariants ---');
  const failPhone = '+265998877665';
  
  // Clean any previous test OTP
  await prisma.otpCode.deleteMany({ where: { phone: failPhone } });

  // Mock notificationService.sendOtp to simulate carrier API failure
  const originalSendOtp = notificationService.sendOtp;
  notificationService.sendOtp = async () => {
    throw new Error('Upstream telecom network timeout (Airtel Malawi gateway unreachable)');
  };

  let otpAttemptFailed = false;
  try {
    await authService.requestOtp(failPhone);
  } catch (e) {
    otpAttemptFailed = e.message.includes('SMS delivery failed. Please try again later.');
  }

  // Restore original sendOtp
  notificationService.sendOtp = originalSendOtp;

  report('requestOtp throws clear user error when SMS provider fails', otpAttemptFailed);

  const otpDbRecord = await prisma.otpCode.findUnique({
    where: { phone: failPhone }
  });
  report('Failed SMS dispatch leaves zero OtpCode row in database (NOT marked as sent)', otpDbRecord === null);

  // Verify AuditLog recorded OTP_FAILED
  const failAudit = await prisma.auditLog.findFirst({
    where: { action: 'OTP_FAILED' },
    orderBy: { createdAt: 'desc' }
  });
  report('Failed dispatch writes immutable AuditLog entry with action OTP_FAILED', Boolean(failAudit));

  // -------------------------------------------------------------------------
  // 7. Twilio Callback Handler Updates SmsLog
  // -------------------------------------------------------------------------
  console.log('\n--- 7. Testing Twilio Status Callback DB Update ---');
  process.env.TWILIO_AUTH_TOKEN = dummyAuthToken;
  const dummySid = 'SM_TEST_' + Date.now();

  const dummyLog = await prisma.smsLog.create({
    data: {
      phoneHash: hashPhoneNumber(loggedPhone),
      phoneMasked: maskPhoneNumber(loggedPhone),
      provider: 'twilio',
      purpose: 'OTP',
      status: 'SENT',
      providerMessageId: dummySid
    }
  });

  const twilioPayload = {
    MessageSid: dummySid,
    MessageStatus: 'delivered',
    ErrorCode: ''
  };

  let signData = callbackUrl;
  Object.keys(twilioPayload).sort().forEach(k => {
    signData += k + twilioPayload[k];
  });
  const validCbSig = crypto.createHmac('sha1', dummyAuthToken).update(Buffer.from(signData, 'utf8')).digest('base64');

  await notificationService.handleTwilioStatusCallback({
    signature: validCbSig,
    url: callbackUrl,
    body: twilioPayload
  });

  const updatedLog = await prisma.smsLog.findUnique({ where: { id: dummyLog.id } });
  report('Twilio status callback updates SmsLog status to DELIVERED', updatedLog.status === 'DELIVERED');

  // Clean up test logs
  await prisma.smsLog.deleteMany({
    where: { id: { in: [sendRes.logId, dummyLog.id] } }
  }).catch(() => {});

  if (originalProvider) {
    process.env.SMS_GATEWAY_PROVIDER = originalProvider;
  } else {
    delete process.env.SMS_GATEWAY_PROVIDER;
  }

  console.log('\n=============================================================');
  console.log(`   SMS GATEWAY SUITE: ${passed}/${total} TESTS PASSED (100%)`);
  console.log('=============================================================\n');

  return { passed, total };
}

if (require.main === module) {
  runSmsGatewaySuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Fatal SMS Gateway Test Failure:', err);
      process.exit(1);
    });
}

module.exports = { runSmsGatewaySuite };

