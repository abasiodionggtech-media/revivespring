const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(422).json({ message: e.array()[0].msg }); return true; }
  return false;
}

function mapGoal(g) {
  return {
    id: g.id,
    text: g.text,
    completed: g.completed,
    date: g.date,
    language: g.language,
  };
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// GET /api/goals?date=yyyy-MM-dd
router.get('/', async (req, res, next) => {
  try {
    const date = req.query.date || getToday();
    const goals = await prisma.dailyGoal.findMany({
      where: { userId: req.user.id, date },
      orderBy: { createdAt: 'asc' },
    });
    res.json(goals.map(mapGoal));
  } catch (err) { next(err); }
});

// POST /api/goals
router.post('/',
  [body('text').notEmpty().trim(), body('date').notEmpty()],
  async (req, res, next) => {
    if (validate(req, res)) return;
    try {
      // Free plan: max 3 goals per day
      if (req.user.subscriptionStatus !== 'premium') {
        const date = req.body.date || getToday();
        const count = await prisma.dailyGoal.count({
          where: { userId: req.user.id, date },
        });
        if (count >= 3) {
          return res.status(403).json({
            message: 'Free plan limit: 3 goals per day. Upgrade to Premium for unlimited.',
          });
        }
      }

      const goal = await prisma.dailyGoal.create({
        data: {
          userId: req.user.id,
          text: req.body.text,
          completed: req.body.completed || false,
          date: req.body.date || getToday(),
          language: req.body.language || req.user.language,
        },
      });
      res.status(201).json(mapGoal(goal));
    } catch (err) { next(err); }
  }
);

// PATCH /api/goals/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.dailyGoal.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ message: 'Goal not found.' });

    const data = {};
    if (req.body.text !== undefined) data.text = req.body.text;
    if (req.body.completed !== undefined) data.completed = req.body.completed;

    const goal = await prisma.dailyGoal.update({
      where: { id: req.params.id },
      data,
    });

    // Update streak when completing a goal
    if (req.body.completed === true && !existing.completed) {
      await _updateStreak(req.user.id, goal.date);
    }

    res.json(mapGoal(goal));
  } catch (err) { next(err); }
});

// DELETE /api/goals/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.dailyGoal.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ message: 'Goal not found.' });
    await prisma.dailyGoal.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ─── Streak calculation helper ─────────────────────────────────────────────────
async function _updateStreak(userId, date) {
  const analytics = await prisma.analytics.upsert({
    where: { userId },
    create: { userId, currentStreak: 1, longestStreak: 1, lastActiveDate: date },
    update: {},
  });

  const last = analytics.lastActiveDate;
  if (!last) {
    await prisma.analytics.update({
      where: { userId },
      data: { currentStreak: 1, longestStreak: 1, lastActiveDate: date },
    });
    return;
  }

  const lastDate = new Date(last);
  const currentDate = new Date(date);
  const diffDays = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));

  let newStreak = analytics.currentStreak;
  if (diffDays === 1) {
    newStreak += 1;
  } else if (diffDays > 1) {
    newStreak = 1;
  }

  const newLongest = Math.max(newStreak, analytics.longestStreak);

  await prisma.analytics.update({
    where: { userId },
    data: {
      currentStreak: newStreak,
      longestStreak: newLongest,
      lastActiveDate: date,
    },
  });
}

module.exports = router;
