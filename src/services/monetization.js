'use strict';

function readUserMeta(user) {
  if (!user || !user.onboardingData || typeof user.onboardingData !== 'object' || Array.isArray(user.onboardingData)) {
    return {};
  }
  return { ...user.onboardingData };
}

function localDateForTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

const PLAN_RANK = { free: 0, standard: 1, premium: 2 };

function effectivePlan(user) {
  if (user && user.role === 'admin') {
    return 'premium';
  }

  const meta = readUserMeta(user);
  const subscription = meta.subscription && typeof meta.subscription === 'object' ? meta.subscription : {};
  if (subscription.expiresAt) {
    const expiresAt = new Date(subscription.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt > new Date()) {
      // `tier` was added alongside the standard/premium split — older purchases
      // recorded before that always meant premium, so default to it here.
      return subscription.tier === 'standard' ? 'standard' : 'premium';
    }
    return 'free';
  }

  return (user && user.subscriptionStatus) || 'free';
}

function isPremiumUser(user) {
  return effectivePlan(user) === 'premium';
}

function isPaidUser(user) {
  return PLAN_RANK[effectivePlan(user)] >= PLAN_RANK.standard;
}

function planAtLeast(user, tier) {
  return PLAN_RANK[effectivePlan(user)] >= (PLAN_RANK[tier] ?? 99);
}

function aiUsageForToday(user, date = new Date()) {
  const meta = readUserMeta(user);
  const today = localDateForTimeZone(date, user && user.timezone ? user.timezone : 'UTC');
  const raw = meta.aiUsage && typeof meta.aiUsage === 'object' ? meta.aiUsage : {};
  if (raw.date !== today) {
    return { date: today, used: 0 };
  }
  return {
    date: today,
    used: Number.isFinite(raw.used) ? Number(raw.used) : 0,
  };
}

function aiAdViewsForToday(user, date = new Date()) {
  const meta = readUserMeta(user);
  const today = localDateForTimeZone(date, user && user.timezone ? user.timezone : 'UTC');
  const raw = meta.aiAdViews && typeof meta.aiAdViews === 'object' ? meta.aiAdViews : {};
  if (raw.date !== today) {
    return { date: today, used: 0 };
  }
  return {
    date: today,
    used: Number.isFinite(raw.used) ? Number(raw.used) : 0,
  };
}

function dailyUsageFor(user, metaKey, date = new Date()) {
  const meta = readUserMeta(user);
  const today = localDateForTimeZone(date, user && user.timezone ? user.timezone : 'UTC');
  const raw = meta[metaKey] && typeof meta[metaKey] === 'object' ? meta[metaKey] : {};
  if (raw.date !== today) {
    return { date: today, used: 0 };
  }
  return {
    date: today,
    used: Number.isFinite(raw.used) ? Number(raw.used) : 0,
  };
}

function mergeUserMeta(user, patch) {
  const current = readUserMeta(user);
  return {
    ...current,
    ...patch,
  };
}

module.exports = {
  aiAdViewsForToday,
  aiUsageForToday,
  dailyUsageFor,
  effectivePlan,
  isPremiumUser,
  isPaidUser,
  planAtLeast,
  PLAN_RANK,
  localDateForTimeZone,
  mergeUserMeta,
  readUserMeta,
};
