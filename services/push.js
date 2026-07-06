let admin;
let appInitialized = false;

function getFirebaseAdmin() {
  if (appInitialized) return admin;

  try {
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        admin.initializeApp();
      }
    }
    appInitialized = true;
    return admin;
  } catch (err) {
    console.warn('[PUSH] Firebase Admin is not configured:', err.message);
    return null;
  }
}

async function sendPushToTokens(tokens, { title, body, data = {} }) {
  const firebase = getFirebaseAdmin();
  const cleanTokens = [...new Set((tokens || []).filter(Boolean))];
  if (!firebase || !cleanTokens.length) return { sent: 0, failed: cleanTokens.length };

  const message = {
    tokens: cleanTokens,
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, String(value ?? '')])),
    android: {
      priority: 'high',
      notification: {
        channelId: 'account_alerts',
        priority: 'high',
        defaultSound: true,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
  };

  const response = await firebase.messaging().sendEachForMulticast(message);
  return { sent: response.successCount, failed: response.failureCount, response };
}

module.exports = { sendPushToTokens };
