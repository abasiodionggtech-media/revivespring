'use strict';

/**
 * src/jobs/streakGraceCheck.js
 *
 * Once a day, finds users who missed yesterday but still have their
 * 1-day grace period available, and sends them an in-app notification
 * nudging them to complete something today before the grace expires.
 *
 * Call this from src/index.js on startup and then every hour — it
 * guards against sending more than one grace notification per user
 * per day itself, so an hourly interval is safe.
 */

const prisma = require('../config/prisma');

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

async function runStreakGraceCheckJob() {
  const date = todayStr();
  const yesterday = yesterdayStr();

  // At risk: last active exactly 2 days ago (missed yesterday), grace not yet used, streak worth protecting.
  const twoDaysAgo = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 2);
    return d.toISOString().split('T')[0];
  })();

  const atRisk = await prisma.analytics.findMany({
    where: { lastActiveDate: twoDaysAgo, gracePeriodUsed: false, currentStreak: { gt: 0 } },
    include: { user: { select: { id: true, language: true, pushNotificationsEnabled: true } } },
  });

  for (const analytics of atRisk) {
    const already = await prisma.notification.findFirst({
      where: { userId: analytics.userId, type: 'streak_grace', createdAt: { gte: new Date(`${date}T00:00:00Z`) } },
    });
    if (already) continue;

    const isFr = analytics.user?.language === 'fr';
    await prisma.notification.create({
      data: {
        userId: analytics.userId,
        type: 'streak_grace',
        title: isFr ? 'Votre serie est en periode de grace' : 'Your streak is in its grace day',
        body: isFr
          ? `Vous avez manque hier, mais votre serie de ${analytics.currentStreak} jours est protegee aujourd'hui. Priez aujourd'hui pour la garder.`
          : `You missed yesterday, but your ${analytics.currentStreak}-day streak is protected today. Complete one prayer or goal today to keep it alive.`,
        metadata: { currentStreak: analytics.currentStreak, graceDate: yesterday },
      },
    });
  }

  return { checked: atRisk.length };
}

module.exports = { runStreakGraceCheckJob };
