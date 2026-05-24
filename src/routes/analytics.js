const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();

// GET /api/analytics
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Fetch or create analytics row
    const analytics = await prisma.analytics.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    // Total goals & completed goals
    const [totalGoals, completedGoals] = await Promise.all([
      prisma.dailyGoal.count({ where: { userId } }),
      prisma.dailyGoal.count({ where: { userId, completed: true } }),
    ]);

    // Weekly goals (last 7 days, Mon–Sun aligned)
    const weeklyGoals = await _weeklyGoals(userId);

    // Mood frequency from saved prayers
    const moodFrequency = await _moodFrequency(userId);

    res.json({
      totalPrayers: analytics.totalPrayers,
      answeredPrayers: analytics.answeredPrayers,
      currentStreak: analytics.currentStreak,
      longestStreak: analytics.longestStreak,
      totalGoals,
      completedGoals,
      weeklyGoals,
      moodFrequency,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _weeklyGoals(userId) {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const counts = await Promise.all(
    days.map(date =>
      prisma.dailyGoal.count({ where: { userId, date, completed: true } })
    )
  );
  return counts;
}

async function _moodFrequency(userId) {
  const prayers = await prisma.prayer.findMany({
    where: { userId },
    select: { mood: true },
  });

  const freq = {};
  for (const p of prayers) {
    freq[p.mood] = (freq[p.mood] || 0) + 1;
  }
  return freq;
}

module.exports = router;
