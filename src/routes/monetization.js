'use strict';

const crypto = require('crypto');
const express = require('express');
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');
const {
  aiUsageForToday,
  effectivePlan,
  isPremiumUser,
  mergeUserMeta,
  readUserMeta,
} = require('../services/monetization');

const router = express.Router();

const DEFAULT_SETTINGS = {
  ads_enabled: 'true',
  ads_banner_enabled: 'true',
  ai_ad_unlock_enabled: 'true',
  ai_ad_daily_limit: '5',
  subscription_price_ngn: '50',
  subscription_price_label_en: '50 naira / month',
  subscription_price_label_fr: '50 nairas / mois',
  subscription_google_play_product_id: 'revivespring_premium_monthly',
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
  return settings;
}

function buildStatus(user, settings) {
  const usage = aiUsageForToday(user);
  const maxDailyUses = Math.max(0, parseInt(settings.ai_ad_daily_limit || '5', 10) || 5);
  const premium = isPremiumUser(user);
  const remainingToday = premium ? maxDailyUses : Math.max(0, maxDailyUses - usage.used);

  return {
    plan: effectivePlan(user),
    isPremium: premium,
    isAdmin: user.role === 'admin',
    pricing: {
      currency: 'NGN',
      amountNgn: Number(settings.subscription_price_ngn || '50') || 50,
      googlePlayProductId: settings.subscription_google_play_product_id,
      labelEn: settings.subscription_price_label_en,
      labelFr: settings.subscription_price_label_fr,
    },
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
      usedToday: premium ? 0 : usage.used,
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
    const maxDailyUses = Math.max(0, parseInt(settings.ai_ad_daily_limit || '5', 10) || 5);
    if (usage.used >= maxDailyUses) {
      return res.status(403).json({
        message: 'Daily AI limit reached for free users.',
        code: 'AI_DAILY_LIMIT_REACHED',
        ...buildStatus(req.user, settings).ai,
      });
    }

    const unlockToken = crypto.randomBytes(24).toString('hex');
    const nextMeta = mergeUserMeta(req.user, {
      aiUsage: { date: usage.date, used: usage.used + 1 },
      aiUnlock: { token: unlockToken, date: usage.date, grantedAt: new Date().toISOString() },
    });
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { onboardingData: nextMeta },
    });
    res.json({
      unlockToken,
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

    const nextMeta = mergeUserMeta(req.user, {
      subscription: {
        provider: 'google_play',
        orderId: orderId || null,
        productId: productId || null,
        purchaseToken: purchaseToken || null,
        purchaseTime: purchaseTime || new Date().toISOString(),
        currencyCode: currencyCode || null,
        priceAmountMicros: priceAmountMicros || null,
        packageName: packageName || null,
        acknowledged: acknowledged === true,
        recordedAt: new Date().toISOString(),
      },
    });

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        subscriptionStatus: 'premium',
        onboardingData: nextMeta,
      },
    });

    res.json({
      message: 'Mobile subscription recorded.',
      plan: effectivePlan(updatedUser),
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        subscriptionStatus: effectivePlan(updatedUser),
        onboardingData: readUserMeta(updatedUser),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
