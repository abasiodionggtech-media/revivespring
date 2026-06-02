const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();
const today = () => new Date().toISOString().split('T')[0];

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function mapGoal(goal) {
  return {
    id: goal.id, text: goal.text, kind: goal.kind, content: goal.content,
    duration_seconds: goal.durationSeconds, completed: goal.completed,
    completed_at: goal.completedAt, date: goal.date, language: goal.language,
  };
}

async function assignDailyGoals(user, date) {
  const templates = await prisma.dailyGoalTemplate.findMany({
    where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  if (!templates.length) return;
  await Promise.all(templates.map(template => prisma.dailyGoal.upsert({
    where: { userId_date_templateId: { userId: user.id, date, templateId: template.id } },
    update: {},
    create: {
      userId: user.id, templateId: template.id, date,
      text: user.language === 'fr' && template.titleFr ? template.titleFr : template.titleEn,
      content: user.language === 'fr' && template.contentFr ? template.contentFr : template.contentEn,
      kind: template.kind, durationSeconds: template.durationSeconds, language: user.language,
    },
  })));
}

router.get('/', async (req, res, next) => {
  try {
    const date = req.query.date || today();
    await assignDailyGoals(req.user, date);
    const goals = await prisma.dailyGoal.findMany({ where: { userId: req.user.id, date }, orderBy: { createdAt: 'asc' } });
    res.json(goals.map(mapGoal));
  } catch (err) { next(err); }
});

router.post('/', [body('text').notEmpty().trim()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const goal = await prisma.dailyGoal.create({
      data: { userId: req.user.id, text: req.body.text, date: req.body.date || today(), language: req.body.language || req.user.language },
    });
    res.status(201).json(mapGoal(goal));
  } catch (err) { next(err); }
});

// Goal completion is server-validated. Scripture and timed activities must stay open long enough.
router.post('/:id/complete', [body('elapsed_seconds').isInt({ min: 0 })], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const existing = await prisma.dailyGoal.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!existing) return res.status(404).json({ message: 'Goal not found.' });
    if (existing.completed) return res.json(mapGoal(existing));
    if (req.body.elapsed_seconds < existing.durationSeconds) {
      return res.status(422).json({ message: `Keep this activity open for ${existing.durationSeconds} seconds before completing it.` });
    }
    const goal = await prisma.dailyGoal.update({
      where: { id: existing.id }, data: { completed: true, completedAt: new Date() },
    });
    await updateStreak(req.user.id, goal.date);
    res.json(mapGoal(goal));
  } catch (err) { next(err); }
});

async function updateStreak(userId, date) {
  const analytics = await prisma.analytics.upsert({ where: { userId }, create: { userId }, update: {} });
  if (analytics.lastActiveDate === date) return;
  const previous = analytics.lastActiveDate ? new Date(`${analytics.lastActiveDate}T00:00:00Z`) : null;
  const current = new Date(`${date}T00:00:00Z`);
  const diff = previous ? Math.round((current - previous) / 86400000) : null;
  const currentStreak = diff === 1 ? analytics.currentStreak + 1 : 1;
  await prisma.analytics.update({
    where: { userId },
    data: { currentStreak, longestStreak: Math.max(currentStreak, analytics.longestStreak), lastActiveDate: date },
  });
}

module.exports = router;
