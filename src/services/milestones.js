'use strict';

/**
 * src/services/milestones.js
 *
 * Faith Milestones & Badges — a lightweight checker service. Rather than
 * hooking into every existing route that could trigger a milestone
 * (prayers, goals, journal, fasts, challenges), the client calls
 * `POST /api/milestones/check` at natural moments (e.g. Home screen
 * load, after completing an action). This keeps the feature additive and
 * avoids touching already-working route files.
 */

const prisma = require('../config/prisma');

async function currentStats(userId) {
  const [prayers, goalsCompleted, journalEntries, fastsCompleted, challengesCompleted, readingPlansCompleted, analytics] =
    await Promise.all([
      prisma.prayer.count({ where: { userId } }),
      prisma.dailyGoal.count({ where: { userId, completed: true } }).catch(() => 0),
      prisma.journalEntry.count({ where: { userId } }),
      prisma.fast.count({ where: { userId, status: 'completed' } }),
      prisma.challengeEnrollment.count({ where: { userId, finishedAt: { not: null } } }),
      prisma.readingPlanProgress.count({ where: { userId, finishedAt: { not: null } } }),
      prisma.analytics.findUnique({ where: { userId } }),
    ]);

  return {
    streak: analytics?.currentStreak || 0,
    prayers_total: prayers,
    goals_total: goalsCompleted,
    journal_total: journalEntries,
    fasts_total: fastsCompleted,
    challenges_total: challengesCompleted,
    reading_plans_total: readingPlansCompleted,
  };
}

async function checkAndAwardMilestones(userId) {
  const [milestones, alreadyAwarded, stats] = await Promise.all([
    prisma.milestone.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.userMilestone.findMany({ where: { userId }, select: { milestoneId: true, achievedAt: true } }),
    currentStats(userId),
  ]);

  const awardedIds = new Set(alreadyAwarded.map((row) => row.milestoneId));
  const newlyAwarded = [];

  for (const milestone of milestones) {
    if (awardedIds.has(milestone.id)) continue;
    const value = stats[milestone.criteriaType];
    if (typeof value === 'number' && value >= milestone.criteriaValue) {
      const created = await prisma.userMilestone.create({
        data: { userId, milestoneId: milestone.id },
      }).catch(() => null);
      if (created) newlyAwarded.push(milestone);
    }
  }

  const achievedMap = new Map(alreadyAwarded.map((row) => [row.milestoneId, row.achievedAt]));
  newlyAwarded.forEach((m) => achievedMap.set(m.id, new Date()));

  const all = milestones.map((m) => ({
    id: m.id,
    key: m.key,
    titleEn: m.titleEn,
    titleFr: m.titleFr,
    descriptionEn: m.descriptionEn,
    descriptionFr: m.descriptionFr,
    icon: m.icon,
    criteriaType: m.criteriaType,
    criteriaValue: m.criteriaValue,
    achieved: achievedMap.has(m.id),
    achievedAt: achievedMap.get(m.id) || null,
    progress: Math.min(1, (stats[m.criteriaType] || 0) / m.criteriaValue),
  }));

  return { all, newlyAwarded: newlyAwarded.map((m) => m.key) };
}

module.exports = { checkAndAwardMilestones, currentStats };
