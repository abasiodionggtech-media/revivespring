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

function effectivePlan(user) {
  return user && user.role === 'admin'
    ? 'premium'
    : (user && user.subscriptionStatus) || 'free';
}

function isPremiumUser(user) {
  return effectivePlan(user) === 'premium';
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

function mergeUserMeta(user, patch) {
  const current = readUserMeta(user);
  return {
    ...current,
    ...patch,
  };
}

module.exports = {
  aiUsageForToday,
  effectivePlan,
  isPremiumUser,
  localDateForTimeZone,
  mergeUserMeta,
  readUserMeta,
};
