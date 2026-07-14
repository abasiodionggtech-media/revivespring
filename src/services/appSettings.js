'use strict';

const prisma = require('../config/prisma');

/**
 * The single source of truth for app settings.
 *
 * Previously each route kept its own copy of the defaults and its own loader,
 * which is how the `_3mo` product-ID drift happened — one file was updated and
 * the other wasn't. Everything now reads from here.
 */
const DEFAULTS = {
  // ── Trial ──
  // A new account gets full PREMIUM access for this many days.
  trial_days: '3',

  // ── AI allowance ──
  // Standard tier gets this many AI messages per calendar month.
  // Unused messages do NOT roll over.
  standard_ai_messages_per_month: '20',

  // ── Subscriptions ──
  subscription_currency: 'USD',
  subscription_first_term_months: '3',
  subscription_renewal_term_months: '1',
  subscription_first_term_discount_percent: '4',
  subscription_standard_price_usd: '9.25',
  subscription_premium_price_usd: '15.50',
  subscription_google_play_standard_product_id: 'revivespring_standard',
  subscription_google_play_premium_product_id: 'revivespring_premium',
};

async function load() {
  let rows = [];
  try {
    rows = await prisma.appSetting.findMany({
      where: { key: { in: Object.keys(DEFAULTS) } },
      select: { key: true, value: true },
    });
  } catch (err) {
    console.error('[SETTINGS] load failed, falling back to defaults:', err.message);
    return { ...DEFAULTS };
  }

  const settings = { ...DEFAULTS };
  rows.forEach((row) => {
    if (row.value !== null && row.value !== undefined && row.value !== '') {
      settings[row.key] = row.value;
    }
  });

  // Self-heal: older builds used product IDs with a "_3mo" suffix that no longer
  // exists in Play Console. A stale DB row would otherwise silently override the
  // correct default and break every purchase.
  if (String(settings.subscription_google_play_standard_product_id).includes('_3mo')) {
    settings.subscription_google_play_standard_product_id = DEFAULTS.subscription_google_play_standard_product_id;
  }
  if (String(settings.subscription_google_play_premium_product_id).includes('_3mo')) {
    settings.subscription_google_play_premium_product_id = DEFAULTS.subscription_google_play_premium_product_id;
  }

  return settings;
}

module.exports = { load, DEFAULTS };
