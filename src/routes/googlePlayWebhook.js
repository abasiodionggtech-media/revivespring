'use strict';

/**
 * src/routes/googlePlayWebhook.js
 *
 * Receives Google Play's Real-time Developer Notifications (RTDN) via a
 * Cloud Pub/Sub push subscription, so subscription status stays correct
 * even when a user's app isn't open to call /subscription/mobile-sync
 * (e.g. a renewal, cancellation, or refund happening in the background).
 *
 * ── Setup required in Google Cloud / Play Console (not done by this code) ──
 * 1. Create a Pub/Sub topic in your Google Cloud project.
 * 2. In Play Console → Monetization setup, point "Real-time developer
 *    notifications" at that topic.
 * 3. Create a Pub/Sub PUSH subscription on that topic, with the endpoint
 *    URL set to:
 *      https://<your-api-domain>/api/webhooks/google-play?token=<GOOGLE_PLAY_WEBHOOK_SECRET>
 *    (the same secret you set in this server's GOOGLE_PLAY_WEBHOOK_SECRET
 *    environment variable — this is how the endpoint verifies the request
 *    actually came from your own Pub/Sub subscription).
 *
 * ── Known limitation ──
 * RTDN payloads only ever contain a purchaseToken, never full purchase
 * details or an authoritative expiry timestamp — Google's intent is that
 * you use the notification purely as a signal to re-fetch the purchase
 * from the Play Developer API. Calling that API requires a Google service
 * account with the Android Publisher API enabled, which is a Google Cloud
 * Console setup step this code can't perform for you. Until that's wired
 * up, this webhook makes a best-effort update based on the notification
 * type alone (extending/ending access using the same term-length logic as
 * mobile-sync) rather than pulling the fully authoritative state.
 */

const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();

const DEFAULT_SETTINGS = {
  subscription_google_play_standard_product_id: 'revivespring_standard',
  subscription_google_play_premium_product_id: 'revivespring_premium',
  subscription_first_term_months: '3',
  subscription_renewal_term_months: '1',
};

async function loadProductSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: Object.keys(DEFAULT_SETTINGS) } },
    select: { key: true, value: true },
  });
  const settings = { ...DEFAULT_SETTINGS };
  rows.forEach((row) => { settings[row.key] = row.value; });
  return settings;
}

// Notification type codes from Google Play's RTDN subscriptionNotification.
const NOTIFICATION_TYPES = {
  1: 'SUBSCRIPTION_RECOVERED',
  2: 'SUBSCRIPTION_RENEWED',
  3: 'SUBSCRIPTION_CANCELED',
  4: 'SUBSCRIPTION_PURCHASED',
  5: 'SUBSCRIPTION_ON_HOLD',
  6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
  7: 'SUBSCRIPTION_RESTARTED',
  8: 'SUBSCRIPTION_PRICE_CHANGE_CONFIRMED',
  9: 'SUBSCRIPTION_DEFERRED',
  10: 'SUBSCRIPTION_PAUSED',
  11: 'SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED',
  12: 'SUBSCRIPTION_REVOKED',
  13: 'SUBSCRIPTION_EXPIRED',
};

// Notification types that mean "the subscription is active/renewed."
// PURCHASED is the very first payment — a one-time charge covering the
// 3-month intro period. RENEWED/RECOVERED/RESTARTED are all ongoing
// monthly renewals at the regular price, since the base plan itself bills
// monthly from then on.
const FIRST_PURCHASE_TYPES = new Set([4]);
const RENEWAL_TYPES = new Set([1, 2, 7]);
// Notification types that mean "access should end now."
const DEACTIVATING_TYPES = new Set([10, 12, 13]);

router.post('/google-play', async (req, res) => {
  // Verify this request actually came from our own Pub/Sub push subscription.
  const expectedToken = process.env.GOOGLE_PLAY_WEBHOOK_SECRET;
  if (expectedToken && req.query.token !== expectedToken) {
    console.warn('[GOOGLE-PLAY-WEBHOOK] Rejected request with missing/incorrect token.');
    return res.status(401).json({ message: 'Unauthorized.' });
  }
  if (!expectedToken) {
    console.warn('[GOOGLE-PLAY-WEBHOOK] GOOGLE_PLAY_WEBHOOK_SECRET is not set — accepting requests unverified. Set this env var before relying on this endpoint.');
  }

  // Pub/Sub always acks quickly and retries with backoff on non-2xx, so we
  // want to return 200 for anything we can parse, even if we don't act on
  // every notification type — otherwise a redelivery storm piles up.
  try {
    const base64Data = req.body && req.body.message && req.body.message.data;
    if (!base64Data) {
      console.warn('[GOOGLE-PLAY-WEBHOOK] Missing message.data in push payload.');
      return res.status(200).json({ received: true, ignored: 'no data' });
    }

    const decoded = JSON.parse(Buffer.from(base64Data, 'base64').toString('utf8'));

    if (decoded.testNotification) {
      console.log('[GOOGLE-PLAY-WEBHOOK] Test notification received — Play Console setup looks correct.');
      return res.status(200).json({ received: true, test: true });
    }

    const notification = decoded.subscriptionNotification;
    if (!notification) {
      // One-time product notifications etc. — nothing for us to do yet.
      return res.status(200).json({ received: true, ignored: 'not a subscription notification' });
    }

    const { notificationType, purchaseToken, subscriptionId } = notification;
    const typeName = NOTIFICATION_TYPES[notificationType] || `UNKNOWN(${notificationType})`;
    console.log(`[GOOGLE-PLAY-WEBHOOK] ${typeName} for token ending ...${String(purchaseToken || '').slice(-8)}`);

    const user = await prisma.user.findUnique({ where: { lastPurchaseToken: purchaseToken || '__none__' } });
    if (!user) {
      // Most likely this purchase hasn't synced via mobile-sync yet, or is
      // older than the lastPurchaseToken column. Nothing to update safely.
      console.warn(`[GOOGLE-PLAY-WEBHOOK] No user found for this purchase token (${typeName}) — skipping.`);
      return res.status(200).json({ received: true, matched: false });
    }

    const meta = (user.onboardingData && typeof user.onboardingData === 'object') ? { ...user.onboardingData } : {};
    const subscription = { ...(meta.subscription || {}) };

    if (DEACTIVATING_TYPES.has(notificationType)) {
      subscription.status = typeName;
      subscription.deactivatedAt = new Date().toISOString();
      meta.subscription = subscription;
      await prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: 'free', onboardingData: meta },
      });
    } else if (FIRST_PURCHASE_TYPES.has(notificationType) || RENEWAL_TYPES.has(notificationType)) {
      const settings = await loadProductSettings();
      const tier = subscriptionId === settings.subscription_google_play_standard_product_id ? 'standard' : 'premium';
      const isFirstPurchase = FIRST_PURCHASE_TYPES.has(notificationType);
      const termMonths = isFirstPurchase
        ? Math.max(1, parseInt(settings.subscription_first_term_months || '3', 10) || 3)
        : Math.max(1, parseInt(settings.subscription_renewal_term_months || '1', 10) || 1);
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + termMonths);

      subscription.status = typeName;
      subscription.tier = tier;
      subscription.expiresAt = expiresAt.toISOString();
      subscription.updatedViaWebhookAt = new Date().toISOString();
      if (isFirstPurchase && !subscription.firstPaymentAt) {
        subscription.firstPaymentAt = new Date().toISOString();
      }
      meta.subscription = subscription;

      await prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: tier, onboardingData: meta },
      });
    } else {
      // CANCELED / ON_HOLD / IN_GRACE_PERIOD / PRICE_CHANGE_CONFIRMED /
      // DEFERRED / PAUSE_SCHEDULE_CHANGED — informational only for now;
      // access doesn't change immediately for these.
      subscription.status = typeName;
      subscription.lastNotificationAt = new Date().toISOString();
      meta.subscription = subscription;
      await prisma.user.update({ where: { id: user.id }, data: { onboardingData: meta } });
    }

    return res.status(200).json({ received: true, matched: true, type: typeName });
  } catch (err) {
    console.error('[GOOGLE-PLAY-WEBHOOK] Error processing notification:', err.message);
    // Still 200 — we don't want Pub/Sub endlessly retrying a payload that
    // will never parse successfully.
    return res.status(200).json({ received: true, error: true });
  }
});

module.exports = router;
