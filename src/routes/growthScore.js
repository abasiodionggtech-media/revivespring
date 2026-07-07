'use strict';

/**
 * src/routes/growthScore.js
 *
 * GET /api/growth-score — aggregates existing analytics + Day 1-5 feature
 * data into a single 0-100 Spiritual Growth Score with a category
 * breakdown, for the dashboard growth widget. Read-only; no new table.
 */

const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();

function pct(value, target) {
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, value / target));
}

router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const [
      prayersTotal,
      goalsCompleted,
      journalTotal,
      fastsCompleted,
      challengesCompleted,
      readingPlansCompleted,
      memoryCardsMastered,
      milestonesEarned,
      analytics,
    ] = await Promise.all([
      prisma.prayer.count({ where: { userId } }),
      prisma.dailyGoal.count({ where: { userId, completed: true } }),
      prisma.journalEntry.count({ where: { userId } }),
      prisma.fast.count({ where: { userId, status: 'completed' } }),
      prisma.challengeEnrollment.count({ where: { userId, finishedAt: { not: null } } }),
      prisma.readingPlanProgress.count({ where: { userId, finishedAt: { not: null } } }),
      prisma.memoryCardProgress.count({ where: { userId, mastered: true } }),
      prisma.userMilestone.count({ where: { userId } }),
      prisma.analytics.findUnique({ where: { userId } }),
    ]);

    const streak = analytics?.currentStreak || 0;

    const categories = [
      {
        key: 'prayer',
        label: 'Prayer',
        weight: 30,
        score: pct(prayersTotal, 50),
        detail: `${prayersTotal} prayers completed`,
      },
      {
        key: 'consistency',
        label: 'Consistency',
        weight: 25,
        score: pct(streak, 30),
        detail: `${streak}-day current streak`,
      },
      {
        key: 'scripture',
        label: 'Scripture Engagement',
        weight: 20,
        score: pct(memoryCardsMastered * 2 + readingPlansCompleted * 5, 20),
        detail: `${memoryCardsMastered} verses mastered, ${readingPlansCompleted} reading plans finished`,
      },
      {
        key: 'growth_actions',
        label: 'Growth Actions',
        weight: 15,
        score: pct(goalsCompleted + challengesCompleted * 5, 40),
        detail: `${goalsCompleted} goals completed, ${challengesCompleted} challenges finished`,
      },
      {
        key: 'reflection',
        label: 'Reflection',
        weight: 10,
        score: pct(journalTotal, 20),
        detail: `${journalTotal} journal entries`,
      },
    ];

    const overall = Math.round(
      categories.reduce((sum, cat) => sum + cat.score * cat.weight, 0),
    );

    res.json({
      overall,
      categories: categories.map((cat) => ({
        key: cat.key,
        label: cat.label,
        weight: cat.weight,
        score: Math.round(cat.score * 100),
        detail: cat.detail,
      })),
      stats: {
        prayers_total: prayersTotal,
        current_streak: streak,
        goals_total: goalsCompleted,
        journal_total: journalTotal,
        fasts_total: fastsCompleted,
        challenges_total: challengesCompleted,
        reading_plans_total: readingPlansCompleted,
        memory_cards_mastered: memoryCardsMastered,
        milestones_earned: milestonesEarned,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
