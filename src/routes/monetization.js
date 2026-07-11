'use strict';

const crypto = require('crypto');
const express = require('express');
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');
const {
  aiAdViewsForToday,
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
  ads_enabled: 'true',
  ads_banner_enabled: 'true',
  ai_ad_unlock_enabled: 'true',
  ai_ad_daily_limit: '5',
  subscription_currency: 'USD',
  subscription_first_term_months: '3',
  subscription_renewal_term_months: '1',
  subscription_first_term_discount_percent: '4',
  subscription_standard_price_usd: '9.25',
  subscription_premium_price_usd: '15.50',
  subscription_google_play_standard_product_id: 'revivespring_standard',
  subscription_google_play_premium_product_id: 'revivespring_premium',
  ad_banner_title_en: 'Grow with ReviveSpring Premium',
  ad_banner_title_fr: 'Grandissez avec ReviveSpring Premium',
  ad_banner_body_en: 'Remove ads, unlock premium features, and keep your prayer journey uninterrupted.',
  ad_banner_body_fr: 'Retirez les publicites, debloquez les fonctions premium et gardez un parcours de priere sans interruption.',
  ad_banner_cta_en: 'Upgrade on Android',
  ad_banner_cta_fr: 'Passer premium sur Android',
  ai_ad_title_en: 'Watch this short ad to use AI',
  ai_ad_title_fr: 'Regardez cette courte pub pour utiliser l IA',
  ai_ad_body_en: 'Free users can unlock one AI conversation by viewing a short sponsor message. Limit: 5 per day.',
  ai_ad_body_fr: 'Les utilisateurs gratuits peuvent debloquer une conversation IA en regardant un court message sponsorise. Limite : 5 par jour.',
  ai_ad_cta_en: 'Continue to AI',
  ai_ad_cta_fr: 'Continuer vers l IA',
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
  const usage = aiUsageForToday(user);
  const adViews = aiAdViewsForToday(user);
  const maxDailyUses = Math.max(0, parseInt(settings.ai_ad_daily_limit || '5', 10) || 5);
  const premium = isPremiumUser(user);
  const paid = isPaidUser(user);
  const remainingToday = premium ? maxDailyUses : Math.max(0, maxDailyUses - adViews.used);

  return {
    plan: effectivePlan(user),
    isPremium: premium,
    isPaid: paid,
    isAdmin: user.role === 'admin',
    plans: buildPlans(settings),
    ads: {
      enabled: toBool(settings.ads_enabled, true),
      bannerEnabled: toBool(settings.ads_banner_enabled, true),
      aiUnlockEnabled: toBool(settings.ai_ad_unlock_enabled, true),
      banner: {
        titleEn: settings.ad_banner_title_en,
        titleFr: settings.ad_banner_title_fr,
        bodyEn: settings.ad_banner_body_en,
        bodyFr: settings.ad_banner_body_fr,
        ctaEn: settings.ad_banner_cta_en,
        ctaFr: settings.ad_banner_cta_fr,
      },
      aiGate: {
        titleEn: settings.ai_ad_title_en,
        titleFr: settings.ai_ad_title_fr,
        bodyEn: settings.ai_ad_body_en,
        bodyFr: settings.ai_ad_body_fr,
        ctaEn: settings.ai_ad_cta_en,
        ctaFr: settings.ai_ad_cta_fr,
      },
    },
    ai: {
      maxDailyUses,
      usedToday: premium ? 0 : adViews.used,
      adViewsToday: premium ? 0 : adViews.used,
      conversationsToday: premium ? 0 : usage.used,
      remainingToday,
      requiresAdUnlock: !premium && toBool(settings.ai_ad_unlock_enabled, true),
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

router.post('/ai/unlock', async (req, res, next) => {
  try {
    const settings = await loadSettings();
    if (!toBool(settings.ads_enabled, true) || !toBool(settings.ai_ad_unlock_enabled, true)) {
      return res.status(403).json({ message: 'AI ad unlock is currently disabled.' });
    }

    if (isPremiumUser(req.user)) {
      return res.json({ unlockToken: null, ...buildStatus(req.user, settings).ai });
    }

    const usage = aiUsageForToday(req.user);
    const adViews = aiAdViewsForToday(req.user);
    const maxDailyUses = Math.max(0, parseInt(settings.ai_ad_daily_limit || '5', 10) || 5);
    if (adViews.used >= maxDailyUses) {
      return res.status(403).json({
        message: 'Daily AI limit reached for free users.',
        code: 'AI_DAILY_LIMIT_REACHED',
        ...buildStatus(req.user, settings).ai,
      });
    }

    const unlockToken = crypto.randomBytes(24).toString('hex');
    const nextMeta = mergeUserMeta(req.user, {
      aiAdViews: { date: adViews.date, used: adViews.used + 1 },
      aiUnlock: {
        token: unlockToken,
        date: adViews.date,
        grantedAt: new Date().toISOString(),
        adViewNumber: adViews.used + 1,
      },
    });
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { onboardingData: nextMeta },
    });
    res.json({
      unlockToken,
      adViewsToday: adViews.used + 1,
      conversationsToday: usage.used,
      ...buildStatus(updatedUser, settings).ai,
    });
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
