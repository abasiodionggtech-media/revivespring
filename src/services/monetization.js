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


// ─── Free trial ───────────────────────────────────────────────────────────
// Every new account gets full PREMIUM access for a few days. When it lapses,
// the account falls back to whatever they've actually paid for (usually free).

function trialStatus(user, settings) {
  const days = Math.max(0, parseInt((settings && settings.trial_days) || '3', 10) || 3);
  if (!user || !user.createdAt) {
    return { active: false, daysLeft: 0, endsAt: null, used: true };
  }
  const start = new Date(user.createdAt);
  if (Number.isNaN(start.getTime())) {
    return { active: false, daysLeft: 0, endsAt: null, used: true };
  }
  const endsAt = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  const now = new Date();
  const active = now < endsAt;
  const msLeft = endsAt.getTime() - now.getTime();

  return {
    active,
    daysLeft: active ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0,
    endsAt: endsAt.toISOString(),
    used: !active,
  };
}

/// True if the person can use a feature right now — either they pay for it,
/// or they're inside the trial (which grants full premium).
function hasAccess(user, settings, requiredTier) {
  if (user && user.role === 'admin') return true;
  if (trialStatus(user, settings).active) return true;         // trial = full premium
  const need = requiredTier === 'premium' ? PLAN_RANK.premium : PLAN_RANK.standard;
  return PLAN_RANK[effectivePlan(user)] >= need;
}

// ─── Monthly AI allowance (Standard tier) ─────────────────────────────────
// Standard gets a fixed number of AI messages each calendar month. Unused
// messages do NOT roll over — we simply key the counter by "YYYY-MM", so the
// count resets to zero on its own when the month ticks over.

function currentMonthKey(date) {
  const d = date || new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function startOfNextMonth(date) {
  const d = date || new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
}

function aiMessagesThisMonth(user) {
  const meta = readUserMeta(user);
  const record = meta.aiMonthlyUsage && typeof meta.aiMonthlyUsage === 'object' ? meta.aiMonthlyUsage : {};
  // A record from a previous month is simply ignored — that IS the no-rollover rule.
  return record.month === currentMonthKey() ? (parseInt(record.used, 10) || 0) : 0;
}

/// Can this person send one more AI message right now?
function canUseAi(user, settings) {
  if (user && user.role === 'admin') return { allowed: true, unlimited: true };
  if (trialStatus(user, settings).active) return { allowed: true, unlimited: true };
  if (isPremiumUser(user)) return { allowed: true, unlimited: true };

  if (effectivePlan(user) === 'standard') {
    const allowance = Math.max(0, parseInt((settings && settings.standard_ai_messages_per_month) || '20', 10) || 20);
    const used = aiMessagesThisMonth(user);
    return {
      allowed: used < allowance,
      unlimited: false,
      used,
      allowance,
      remaining: Math.max(0, allowance - used),
      resetsAt: startOfNextMonth().toISOString(),
    };
  }

  return { allowed: false, unlimited: false, used: 0, allowance: 0, remaining: 0 };
}

/// Records one AI message against this month's allowance.
function recordAiMessage(user) {
  const used = aiMessagesThisMonth(user);
  return { aiMonthlyUsage: { month: currentMonthKey(), used: used + 1 } };
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
  trialStatus,
  hasAccess,
  canUseAi,
  recordAiMessage,
  aiMessagesThisMonth,
  currentMonthKey,
  startOfNextMonth,
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
