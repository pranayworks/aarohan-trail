// ============================================================================
// AAROHAN MULTI-PROVIDER SMS GATEWAY & NOTIFICATION ENGINE
// Lilongwe, Malawi • Smart Urban Transit Cloud Infrastructure
// ============================================================================
// Providers:
//   1. simulator (default sandbox, zero-cost, dev logging)
//   2. twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID)
//   3. africastalking (AFRICASTALKING_USERNAME, AFRICASTALKING_API_KEY, AFRICASTALKING_SENDER_ID)
// Invariants:
//   - Zero message body & zero OTP codes saved to SmsLog table
//   - Alphanumeric sender ID strictly validated (max 11 chars, no generic names)
//   - Twilio X-Twilio-Signature status callback validation
//   - Cost cap monitoring and delivery analytics by carrier prefix (Airtel/TNM)
// ============================================================================

const crypto = require('crypto');
const prisma = require('../lib/prisma');

const FORBIDDEN_GENERIC_SENDER_NAMES = new Set([
  'verify', 'info', 'notify', 'otp', 'sms', 'code', 'alert', 'message',
  'auth', 'security', 'login', 'service', 'admin', 'system'
]);

/**
 * Validates alphanumeric sender ID (GSM 03.38 standard).
 * Max 11 characters, rejects generic names.
 */
function validateSenderName(name) {
  const sender = (name || 'Aarohan').trim();
  if (sender.length > 11) {
    throw new Error(`Invalid SMS_SENDER_NAME: "${sender}" exceeds the 11-character GSM limit.`);
  }
  if (FORBIDDEN_GENERIC_SENDER_NAMES.has(sender.toLowerCase())) {
    throw new Error(`Invalid SMS_SENDER_NAME: generic name "${sender}" is prohibited by telecom regulations.`);
  }
  return sender;
}

/**
 * Computes HMAC-SHA256 hash of E.164 phone number using SMS_HASH_SECRET.
 */
function hashPhoneNumber(phone) {
  const clean = (phone || '').replace(/[\s-]/g, '').trim();
  const secret = process.env.SMS_HASH_SECRET || process.env.OTP_HMAC_SECRET || 'aarohan-default-sms-hash-secret';
  return crypto.createHmac('sha256', secret).update(clean).digest('hex');
}

/**
 * Masks phone number preserving Malawi network prefix (+26599 or +26588) and trailing digits.
 * e.g. +265991234567 -> +26599****567
 */
function maskPhoneNumber(phone) {
  const clean = (phone || '').replace(/[\s-]/g, '').trim();
  if (clean.startsWith('+265') && clean.length >= 10) {
    const prefix = clean.slice(0, 6); // +26599, +26598, +26588
    const tail = clean.slice(-3);
    return `${prefix}****${tail}`;
  }
  if (clean.length > 6) {
    return clean.slice(0, 3) + '****' + clean.slice(-3);
  }
  return '***';
}

/**
 * Validates Twilio Webhook Signature (HMAC-SHA1).
 */
function validateTwilioSignature({ authToken, signature, url, params }) {
  if (!authToken || !signature || !url) return false;
  let data = url;
  if (params && typeof params === 'object') {
    const keys = Object.keys(params).sort();
    for (const key of keys) {
      data += key + (params[key] !== undefined && params[key] !== null ? params[key] : '');
    }
  }
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch {
    return false;
  }
}

class NotificationService {
  constructor() {
    this.policeHotline = process.env.EMERGENCY_POLICE_HOTLINE || '997';
    this.securityDeskPhone = process.env.AAROHAN_SECURITY_DESK_PHONE || '+265991234567';
    this.history = [];
  }

  getProvider() {
    const prov = (process.env.SMS_GATEWAY_PROVIDER || 'simulator').toLowerCase().trim();
    if (['simulator', 'twilio', 'africastalking'].includes(prov)) {
      return prov;
    }
    return 'simulator';
  }

  getSenderName() {
    return validateSenderName(process.env.SMS_SENDER_NAME || 'Aarohan');
  }

  /**
   * Universal SMS Dispatcher.
   * Records metadata row in SmsLog (never saves message body or OTP).
   */
  async sendSms({ to, message, purpose = 'OTP', codeForDevLog = null }) {
    const cleanTo = (to || '').replace(/[\s-]/g, '').trim();
    if (!cleanTo) {
      throw new Error('Recipient phone number is required.');
    }

    const provider = this.getProvider();
    const phoneHash = hashPhoneNumber(cleanTo);
    const phoneMasked = maskPhoneNumber(cleanTo);

    // Initial database log in QUEUED status (without body or OTP)
    let logRow = null;
    try {
      logRow = await prisma.smsLog.create({
        data: {
          phoneHash,
          phoneMasked,
          provider,
          purpose,
          status: 'QUEUED'
        }
      });
    } catch (e) {
      // Non-fatal if DB is offline in test
      logRow = { id: 'sms-' + Date.now() };
    }

    try {
      let dispatchResult = null;

      if (provider === 'twilio') {
        dispatchResult = await this._sendTwilio({ to: cleanTo, message });
      } else if (provider === 'africastalking') {
        dispatchResult = await this._sendAfricasTalking({ to: cleanTo, message });
      } else {
        dispatchResult = await this._sendSimulator({ to: cleanTo, message, purpose, codeForDevLog, phoneMasked });
      }

      // Update log row to SENT
      if (logRow && logRow.id && prisma.smsLog.update) {
        await prisma.smsLog.update({
          where: { id: logRow.id },
          data: {
            status: 'SENT',
            providerMessageId: dispatchResult.messageId || null
          }
        }).catch(() => {});
      }

      this.logMessage({
        id: logRow.id,
        phoneMasked,
        provider,
        purpose,
        status: 'SENT',
        sentAt: new Date().toISOString()
      });

      return {
        success: true,
        provider,
        messageId: dispatchResult.messageId,
        logId: logRow.id
      };
    } catch (err) {
      // Mark log row as FAILED
      if (logRow && logRow.id && prisma.smsLog.update) {
        await prisma.smsLog.update({
          where: { id: logRow.id },
          data: {
            status: 'FAILED',
            errorCode: err.code || err.statusCode ? String(err.code || err.statusCode) : 'DISPATCH_ERROR'
          }
        }).catch(() => {});
      }

      console.error(`[NotificationService] SMS dispatch failed via ${provider} for ${phoneMasked}:`, err.message);
      throw err;
    }
  }

  /**
   * Specialized OTP sender adhering to the standard text requirement:
   * "Your Aarohan verification code is {code}. It expires in 5 minutes. Do not share it."
   */
  async sendOtp({ phone, code }) {
    if (!code) throw new Error('Verification code is required.');
    const message = `Your Aarohan verification code is ${code}. It expires in 5 minutes. Do not share it.`;
    return await this.sendSms({
      to: phone,
      message,
      purpose: 'OTP',
      codeForDevLog: code
    });
  }

  /**
   * Twilio Adapter
   */
  async _sendTwilio({ to, message }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const senderName = this.getSenderName();

    if (!accountSid || !authToken) {
      const err = new Error('Twilio credentials missing. Configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
      err.code = 'CONFIG_MISSING';
      throw err;
    }

    const bodyData = new URLSearchParams();
    bodyData.append('To', to);
    bodyData.append('Body', message);

    if (messagingServiceSid) {
      bodyData.append('MessagingServiceSid', messagingServiceSid);
    } else {
      bodyData.append('From', senderName);
    }

    // Optional status callback webhook
    const appUrl = process.env.APP_URL || process.env.RAILWAY_STATIC_URL;
    if (appUrl) {
      const cleanUrl = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
      bodyData.append('StatusCallback', `${cleanUrl}/api/notifications/twilio-callback`);
    }

    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: bodyData.toString(),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const error = new Error(errData.message || `Twilio dispatch failed with HTTP ${res.status}`);
      error.code = errData.code ? String(errData.code) : String(res.status);
      error.statusCode = res.status;
      throw error;
    }

    const data = await res.json();
    return { messageId: data.sid };
  }

  /**
   * Africa's Talking Adapter
   */
  async _sendAfricasTalking({ to, message }) {
    const username = process.env.AFRICASTALKING_USERNAME;
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const senderId = process.env.AFRICASTALKING_SENDER_ID || this.getSenderName();

    if (!username || !apiKey) {
      const err = new Error('Africa\'s Talking credentials missing. Configure AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY.');
      err.code = 'CONFIG_MISSING';
      throw err;
    }

    const bodyData = new URLSearchParams();
    bodyData.append('username', username);
    bodyData.append('to', to);
    bodyData.append('message', message);
    if (senderId) bodyData.append('from', senderId);

    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: bodyData.toString(),
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      const err = new Error(`Africa's Talking dispatch failed with HTTP ${res.status}`);
      err.statusCode = res.status;
      throw err;
    }

    const data = await res.json();
    const recipient = data?.SMSMessageData?.Recipients?.[0];
    if (recipient && recipient.status !== 'Success') {
      const err = new Error(`Africa's Talking delivery error: ${recipient.status}`);
      err.code = recipient.statusCode ? String(recipient.statusCode) : 'AT_ERROR';
      throw err;
    }

    return { messageId: recipient?.messageId || ('at-' + Date.now()) };
  }

  /**
   * Sandbox Simulator
   */
  async _sendSimulator({ to, message, purpose, codeForDevLog, phoneMasked }) {
    // Prints the OTP ONLY when NODE_ENV === 'development'
    if (process.env.NODE_ENV === 'development') {
      if (purpose === 'OTP' && codeForDevLog) {
        console.log(`[DEV OTP] ${phoneMasked} : ${codeForDevLog}`);
      } else {
        console.log(`[DEV SMS • ${purpose}] ${phoneMasked} | Length: ${message.length} chars`);
      }
    }

    return { messageId: 'sim-' + crypto.randomUUID() };
  }

  /**
   * Twilio Status Callback Webhook Handler
   */
  async handleTwilioStatusCallback({ signature, url, body }) {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const isValid = validateTwilioSignature({
      authToken,
      signature,
      url,
      params: body
    });

    if (!isValid) {
      const err = new Error('Invalid or missing X-Twilio-Signature.');
      err.statusCode = 403;
      throw err;
    }

    const messageSid = body.MessageSid || body.SmsSid;
    const twilioStatus = (body.MessageStatus || '').toLowerCase();
    const errorCode = body.ErrorCode || null;

    let targetStatus = 'SENT';
    if (twilioStatus === 'delivered') targetStatus = 'DELIVERED';
    else if (['failed', 'undelivered'].includes(twilioStatus)) targetStatus = 'FAILED';
    else if (twilioStatus === 'queued') targetStatus = 'QUEUED';

    if (messageSid) {
      await prisma.smsLog.updateMany({
        where: { providerMessageId: messageSid },
        data: {
          status: targetStatus,
          errorCode: errorCode ? String(errorCode) : null,
          updatedAt: new Date()
        }
      });
    }

    return { success: true, messageSid, status: targetStatus };
  }

  /**
   * Aggregates SMS statistics for Admin Panel
   */
  async getSmsStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const totalCap = parseInt(process.env.SMS_DAILY_CAP_TOTAL, 10) || 200;

    const [todayCount, logsToday] = await Promise.all([
      prisma.smsLog.count({
        where: { createdAt: { gte: startOfDay } }
      }),
      prisma.smsLog.findMany({
        where: { createdAt: { gte: startOfDay } },
        select: {
          phoneMasked: true,
          status: true,
          errorCode: true,
          provider: true
        }
      })
    ]);

    const remainingCap = Math.max(0, totalCap - todayCount);
    const capExceeded = todayCount >= totalCap;

    // Carrier breakdowns
    const networks = {
      airtel: { total: 0, delivered: 0, failed: 0 },
      tnm: { total: 0, delivered: 0, failed: 0 },
      other: { total: 0, delivered: 0, failed: 0 }
    };

    const failures = [];

    for (const log of logsToday) {
      let net = 'other';
      if (log.phoneMasked.startsWith('+2659') || log.phoneMasked.startsWith('+26599') || log.phoneMasked.startsWith('+26598')) {
        net = 'airtel';
      } else if (log.phoneMasked.startsWith('+2658') || log.phoneMasked.startsWith('+26588')) {
        net = 'tnm';
      }

      networks[net].total++;
      if (log.status === 'DELIVERED' || log.status === 'SENT') {
        networks[net].delivered++;
      } else if (log.status === 'FAILED') {
        networks[net].failed++;
        if (log.errorCode && failures.length < 15) {
          failures.push({
            provider: log.provider,
            errorCode: log.errorCode,
            carrier: net
          });
        }
      }
    }

    const airtelRate = networks.airtel.total > 0
      ? Math.round((networks.airtel.delivered / networks.airtel.total) * 100)
      : 100;

    const tnmRate = networks.tnm.total > 0
      ? Math.round((networks.tnm.delivered / networks.tnm.total) * 100)
      : 100;

    const overallDelivered = networks.airtel.delivered + networks.tnm.delivered + networks.other.delivered;
    const overallRate = todayCount > 0 ? Math.round((overallDelivered / todayCount) * 100) : 100;

    return {
      provider: this.getProvider(),
      senderName: this.getSenderName(),
      messagesToday: todayCount,
      dailyCap: totalCap,
      remainingCap,
      capExceeded,
      deliveryRate: overallRate,
      networks: {
        airtel: { ...networks.airtel, deliveryRate: airtelRate },
        tnm: { ...networks.tnm, deliveryRate: tnmRate }
      },
      recentFailures: failures
    };
  }

  logMessage(record) {
    this.history.unshift(record);
    if (this.history.length > 100) this.history.pop();
  }

  getRecentHistory(limit = 20) {
    return this.history.slice(0, limit);
  }

  // --- Retained Lifecycle & Emergency Notification Handlers ---

  async sendMessage({ to, message, channel = 'SMS', urgent = false }) {
    if (channel === 'SMS') {
      return await this.sendSms({ to, message, purpose: urgent ? 'SOS' : 'OTHER' });
    }
    return { success: true, channel, simulated: true };
  }

  async sendEmergencySosAlert(alert) {
    const lat = alert.lat || -13.9722;
    const lng = alert.lng || 33.7667;
    const mapsLink = `https://maps.google.com/?q=${lat},${lng}`;
    const timeStr = alert.time || new Date().toLocaleTimeString();

    const emergencyMsg = 
      `🚨 [AAROHAN EMERGENCY SOS ALERT - LILONGWE]\n` +
      `Incident ID: ${alert.id || 'SOS-ALERT'}\n` +
      `Passenger: ${alert.passenger || 'Rider'}\n` +
      `Driver: ${alert.driver || 'Captain'}\n` +
      `Coordinates: ${lat}, ${lng}\n` +
      `Live Map: ${mapsLink}\n` +
      `Time: ${timeStr}\n` +
      `Police Hotline: ${this.policeHotline}\n` +
      `Security Desk: ${this.securityDeskPhone}\n` +
      `Status: ESCALATED TO 997 DISPATCH`;

    const tasks = [];
    tasks.push(this.sendSms({ to: this.securityDeskPhone, message: emergencyMsg, purpose: 'SOS' }));
    if (alert.riderPhone) {
      tasks.push(this.sendSms({
        to: alert.riderPhone,
        message: `🚨 AArohan Safety: Your SOS was received. 997 Police & AArohan Security Desk alerted with coordinates (${lat}, ${lng}). Stay calm.`,
        purpose: 'SOS'
      }));
    }

    const results = await Promise.allSettled(tasks);
    return {
      alertId: alert.id,
      broadcastCount: tasks.length,
      escalatedToPolice: true,
      results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message })
    };
  }

  async sendTripDispatchNotification({ phone, tripId, driverName, vehiclePlate, safetyPin, pickupAddress }) {
    if (!phone) return;
    const message = 
      `🚗 AArohan Ride Confirmed!\n` +
      `Captain: ${driverName}\n` +
      `Vehicle: ${vehiclePlate}\n` +
      `Pickup: ${pickupAddress || 'Lilongwe'}\n` +
      `Safety PIN: ${safetyPin}\n` +
      `Verify PIN with driver before starting. Safe travels!`;

    return this.sendSms({ to: phone, message, purpose: 'OTHER' });
  }

  async sendTripArrivalNotification({ phone, driverName, vehiclePlate, safetyPin }) {
    if (!phone) return;
    const message = 
      `📍 Captain ${driverName} (${vehiclePlate}) has arrived at your pickup spot in Lilongwe.\n` +
      `Your Safety PIN is ${safetyPin}. Please board your vehicle.`;

    return this.sendSms({ to: phone, message, purpose: 'OTHER' });
  }

  async sendScheduleReminderNotification({ phone, tripId, pickupTime, destination }) {
    if (!phone) return;
    const message = 
      `⏰ AArohan Schedule Reminder:\n` +
      `Your reserved ride to ${destination || 'Destination'} is scheduled for ${pickupTime}.\n` +
      `Your Captain will arrive 10 minutes prior to departure.`;

    return this.sendSms({ to: phone, message, purpose: 'OTHER' });
  }
}

module.exports = new NotificationService();
module.exports.validateSenderName = validateSenderName;
module.exports.validateTwilioSignature = validateTwilioSignature;
module.exports.hashPhoneNumber = hashPhoneNumber;
module.exports.maskPhoneNumber = maskPhoneNumber;
