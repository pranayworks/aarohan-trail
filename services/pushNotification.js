// ============================================================================
// AAROHAN PUSH NOTIFICATION SERVICE • FIREBASE CLOUD MESSAGING (FCM)
// Lilongwe, Malawi • Background Dispatch Alerts for Drivers
// ============================================================================

const prisma = require('../lib/prisma');

let firebaseAdmin = null;
let isFCMInitialized = false;

// Safe lazy initialization of Firebase Admin
function initFirebase() {
  if (isFCMInitialized) return firebaseAdmin;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length > 0) {
      firebaseAdmin = admin.app();
      isFCMInitialized = true;
      return firebaseAdmin;
    }

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      firebaseAdmin = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isFCMInitialized = true;
      console.log('[FCM] Initialized with FIREBASE_SERVICE_ACCOUNT_JSON');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      firebaseAdmin = admin.initializeApp({
        credential: admin.credential.applicationDefault()
      });
      isFCMInitialized = true;
      console.log('[FCM] Initialized with GOOGLE_APPLICATION_CREDENTIALS');
    } else {
      console.log('[FCM] No Firebase credentials configured. Push notifications will run in mock simulation mode.');
    }
  } catch (err) {
    console.warn('[FCM] Warning initializing Firebase Admin:', err.message);
  }
  return firebaseAdmin;
}

/**
 * Register or refresh a device push token in DeviceToken table
 */
async function registerDeviceToken({ userId, token, platform = 'ANDROID' }) {
  if (!userId || !token) throw new Error('userId and token are required to register device push token');

  return await prisma.deviceToken.upsert({
    where: {
      userId_token: { userId, token }
    },
    update: {
      platform,
      lastSeenAt: new Date()
    },
    create: {
      userId,
      token,
      platform,
      lastSeenAt: new Date()
    }
  });
}

/**
 * Remove an invalid or expired push token
 */
async function removeDeviceToken(token) {
  try {
    await prisma.deviceToken.deleteMany({
      where: { token }
    });
  } catch (e) {
    console.warn('[FCM] Error pruning invalid device token:', e.message);
  }
}

/**
 * Send push notification to a user's registered devices (FCM Multicast)
 */
async function sendPushToUser(userId, { title, body, data = {} }) {
  if (!userId) return { success: false, reason: 'missing_userId' };

  try {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true }
    });

    if (!tokens || tokens.length === 0) {
      return { success: false, reason: 'no_registered_device_tokens' };
    }

    const registrationTokens = tokens.map(t => t.token);
    const admin = initFirebase();

    if (!admin) {
      // In development or when credentials are not configured, log mock push
      console.log(`[FCM-SIMULATOR] Mock Push to User [${userId}] (${registrationTokens.length} devices):`);
      console.log(`   Title: "${title}"`);
      console.log(`   Body:  "${body}"`);
      console.log(`   Data:  `, data);
      return { success: true, mocked: true, recipientCount: registrationTokens.length };
    }

    // Convert all data values to strings per FCM specifications
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
    }

    const message = {
      notification: {
        title: title || 'AArohan Mobility',
        body: body || 'New update from AArohan'
      },
      data: stringifiedData,
      android: {
        priority: 'high',
        notification: {
          channelId: 'aarohan_dispatch_channel',
          sound: 'default',
          priority: 'max'
        }
      },
      tokens: registrationTokens
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Prune invalid / unregistered tokens
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === 'messaging/invalid-registration-token' ||
            errCode === 'messaging/registration-token-not-registered'
          ) {
            removeDeviceToken(registrationTokens[idx]);
          }
        }
      });
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount
    };
  } catch (err) {
    console.warn('[FCM] Error dispatching push notification:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  registerDeviceToken,
  removeDeviceToken,
  sendPushToUser,
  initFirebase
};

