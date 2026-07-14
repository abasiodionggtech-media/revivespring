'use strict';

const crypto = require('crypto');
const express = require('express');
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');
const {
  trialStatus,
  aiMessagesThisMonth,
  startOfNextMonth,
  aiUsageForToday,
  effectivePlan,
  isPremiumUser,
  isPaidUser,
  mergeUserMeta,
  readUserMeta,
} = require('../services/monetization');
const { sendSubscriptionConfirmationEmail } = require('../services/email');

const router = express.Router();

const DEFAULT_SETTINGS = {
  subscription_currency: 'USD',
  subscription_first_term_months: '3',
  subscription_renewal_term_months: '1',
  subscription_first_term_discount_percent: '4',
  subscription_standard_price_usd: '9.25',
  subscription_premium_price_usd: '15.50',
  trial_days: '3',
  standard_ai_messages_per_month: '20',
  subscription_google_play_standard_product_id: 'revivespring_standard',
  subscription_google_play_premium_product_id: 'revivespring_premium',
};

function safeMonetizationUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    language: user.language || 'en',
    role: user.role || 'user',
    authProvider: user.authProvider || 'email',
    isEmailVerified: user.isEmailVerified !== false,
    profileImageUrl: user.profileImageUrl || null,
    timezone: user.timezone || 'UTC',
    reminderHour: Number.isInteger(user.reminderHour)
      ? user.reminderHour
      : Number.isInteger(user.registeredHour)
        ? user.registeredHour
        : 9,
    reminderMinute: Number.isInteger(user.reminderMinute)
      ? user.reminderMinute
      : 0,
    dailyEmailEnabled: user.dailyEmailEnabled !== false,
    pushNotificationsEnabled: user.pushNotificationsEnabled !== false,
    subscriptionStatus: effectivePlan(user),
    plan: effectivePlan(user),
    hasCompletedOnboarding: !!(
      user.onboardingData &&
      typeof user.onboardingData === 'object' &&
      user.onboardingData.completedAt
    ),
  };
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return fallback;
}

async function loadSettings() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: Object.keys(DEFAULT_SETTINGS) } },
    select: { key: true, value: true },
  });
  const settings = { ...DEFAULT_SETTINGS };
  rows.forEach((row) => {
    settings[row.key] = row.value;
  });
  // Self-heal: earlier versions used product IDs with a "_3mo" suffix that
  // no longer exists in Play Console (the 3-month term is now an offer, not
  // a separate product). If a stale value like that is still saved in the
  // DB, force it back to the correct current ID so the mobile app can find
  // the product. Without this, a leftover DB row would silently override
  // the correct code default and break purchases.
  if (String(settings.subscription_google_play_standard_product_id).includes('_3mo')) {
    settings.subscription_google_play_standard_product_id = 'revivespring_standard';
  }
  if (String(settings.subscription_google_play_premium_product_id).includes('_3mo')) {
    settings.subscription_google_play_premium_product_id = 'revivespring_premium';
  }
  return settings;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function buildPlans(settings) {
  const months = Math.max(1, parseInt(settings.subscription_first_term_months || '3', 10) || 3);
  const discountPercent = Math.max(0, parseFloat(settings.subscription_first_term_discount_percent || '4') || 0);
  const currency = settings.subscription_currency || 'USD';

  const makePlan = (tier, monthlyPrice, productId, labelEn, labelFr) => {
    const fullTermPrice = round2(monthlyPrice * months);
    const firstTermPrice = round2(fullTermPrice * (1 - discountPercent / 100));
    return {
      tier,
      currency,
      monthlyPriceUsd: monthlyPrice,
      termMonths: months,
      fullTermPriceUsd: fullTermPrice,
      firstTermDiscountPercent: discountPercent,
      firstTermPriceUsd: firstTermPrice,
      googlePlayProductId: productId,
      labelEn,
      labelFr,
    };
  };

  return [
    makePlan(
      'standard',
      Number(settings.subscription_standard_price_usd || '9.25') || 9.25,
      settings.subscription_google_play_standard_product_id,
      `$${settings.subscription_standard_price_usd || '9.25'} / month`,
      `${settings.subscription_standard_price_usd || '9.25'} $ / mois`,
    ),
    makePlan(
      'premium',
      Number(settings.subscription_premium_price_usd || '15.50') || 15.5,
      settings.subscription_google_play_premium_product_id,
      `$${settings.subscription_premium_price_usd || '15.50'} / month`,
      `${settings.subscription_premium_price_usd || '15.50'} $ / mois`,
    ),
  ];
}

function buildStatus(user, settings) {
  const plan = effectivePlan(user);
  const premium = isPremiumUser(user);
  const paid = isPaidUser(user);
  const trial = trialStatus(user, settings);

  // Premium: unlimited AI. Standard: a fixed monthly allowance that does NOT
  // roll over — each calendar month starts fresh at the full number.
  const monthlyAllowance = Math.max(0, parseInt(settings.standard_ai_messages_per_month || '20', 10) || 20);
  const usedThisMonth = aiMessagesThisMonth(user);
  const unlimited = premium || trial.active;
  const remaining = unlimited
    ? null
    : (plan === 'standard' ? Math.max(0, monthlyAllowance - usedThisMonth) : 0);

  return {
    plan,
    isPremium: premium,
    isPaid: paid,
    isAdmin: user.role === 'admin',
    plans: buildPlans(settings),
    trial: {
      active: trial.active,
      daysLeft: trial.daysLeft,
      endsAt: trial.endsAt,
      used: trial.used,
    },
    ai: {
      unlimited,
      monthlyAllowance,
      usedThisMonth,
      remainingThisMonth: remaining,
      // no rollover, so this is always the 1st of next month
      resetsAt: startOfNextMonth().toISOString(),
    },
  };
}

router.use(authenticate);

router.get('/status', async (req, res, next) => {
  try {
    const settings = await loadSettings();
    res.json(buildStatus(req.user, settings));
  } catch (err) {
    next(err);
  }
});


router.post('/subscription/mobile-sync', async (req, res, next) => {
  try {
    const {
      orderId,
      productId,
      purchaseToken,
      purchaseTime,
      currencyCode,
      priceAmountMicros,
      packageName,
      acknowledged,
    } = req.body || {};

    const settings = await loadSettings();
    const standardProductId = settings.subscription_google_play_standard_product_id;
    const premiumProductId = settings.subscription_google_play_premium_product_id;
    // Default to premium for unrecognized/legacy product IDs (e.g. the old
    // single monthly SKU) so existing purchasers aren't downgraded.
    const tier = productId === standardProductId ? 'standard' : 'premium';

    const currentSubscription = readUserMeta(req.user).subscription || {};
    // The very first payment covers a 3-month intro period paid as a single
    // upfront charge (a Google Play "single payment" offer on top of an
    // otherwise-monthly base plan). Every payment after that is a normal
    // monthly renewal at the regular price — the base plan itself is
    // monthly, so nothing but the very first charge should ever add 3
    // months at once.
    const isFirstPayment = !currentSubscription.firstPaymentAt;
    const termMonths = isFirstPayment
      ? Math.max(1, parseInt(settings.subscription_first_term_months || '3', 10) || 3)
      : Math.max(1, parseInt(settings.subscription_renewal_term_months || '1', 10) || 1);

    const rawPurchaseTime = Number(purchaseTime);
    const parsedPurchaseTime = new Date(
      Number.isFinite(rawPurchaseTime) && rawPurchaseTime > 0
        ? rawPurchaseTime
        : purchaseTime || Date.now(),
    );
    const normalizedPurchaseTime = Number.isNaN(parsedPurchaseTime.getTime())
      ? new Date()
      : parsedPurchaseTime;
    const existingExpiry = new Date(currentSubscription.expiresAt || 0);
    const baseDate = existingExpiry.getTime() > Date.now()
      ? existingExpiry
      : normalizedPurchaseTime;
    const expiresAt = new Date(baseDate);
    expiresAt.setMonth(expiresAt.getMonth() + termMonths);

    const nextMeta = mergeUserMeta(req.user, {
      subscription: {
        provider: 'google_play',
        tier,
        orderId: orderId || null,
        productId: productId || null,
        purchaseToken: purchaseToken || null,
        purchaseTime: normalizedPurchaseTime.toISOString(),
        currencyCode: currencyCode || null,
        priceAmountMicros: priceAmountMicros || null,
        packageName: packageName || null,
        acknowledged: acknowledged === true,
        recordedAt: new Date().toISOString(),
        durationDays: termMonths * 30,
        termMonths,
        expiresAt: expiresAt.toISOString(),
        firstPaymentAt: currentSubscription.firstPaymentAt || normalizedPurchaseTime.toISOString(),
      },
    });

    let updatedUser;
    try {
      updatedUser = await prisma.user.update({
        where: { id: req.user.id },
        data: {
          subscriptionStatus: tier,
          onboardingData: nextMeta,
          lastPurchaseToken: purchaseToken || undefined,
        },
      });
    } catch (err) {
      // Extremely unlikely (a purchase token colliding with another user's),
      // but if it happens, don't let it block the subscription sync itself —
      // just skip storing the token for RTDN lookup this time.
      if (err.code === 'P2002') {
        console.error('[MOBILE-SYNC] purchaseToken unique collision, skipping token store:', purchaseToken);
        updatedUser = await prisma.user.update({
          where: { id: req.user.id },
          data: { subscriptionStatus: tier, onboardingData: nextMeta },
        });
      } else {
        throw err;
      }
    }

    try {
      await sendSubscriptionConfirmationEmail(
        updatedUser.email,
        updatedUser.fullName,
        {
          orderId,
          productId,
          priceAmountMicros,
          currencyCode,
          purchaseTime,
        },
        updatedUser.language || 'en',
      );
    } catch (emailError) {
      console.error('[EMAIL] Subscription confirmation failed:', emailError.message);
    }

    res.json({
      message: 'Mobile subscription recorded.',
      plan: effectivePlan(updatedUser),
      user: safeMonetizationUser(updatedUser),
      subscription: readUserMeta(updatedUser).subscription || null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
