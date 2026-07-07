'use strict';
const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();
const today = () => new Date().toISOString().split('T')[0];

function formatPlan(plan, progress) {
  const completedDays = Array.isArray(progress?.completedDays) ? progress.completedDays : [];
  return {
    id: plan.id,
    title: plan.titleEn,
    title_fr: plan.titleFr,
    description: plan.descriptionEn,
    duration_days: plan.durationDays,
    days: plan.days,
    started: !!progress,
    completed_days: completedDays,
    days_completed: completedDays.length,
    checked_in_today: progress ? progress.lastCompletedDate === today() : false,
    finished: !!progress?.finishedAt,
  };
}

// GET /api/reading-plans
router.get('/', async (req, res, next) => {
  try {
    const [plans, progressRows] = await Promise.all([
      prisma.readingPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.readingPlanProgress.findMany({ where: { userId: req.user.id } }),
    ]);
    const byId = new Map(progressRows.map((p) => [p.planId, p]));
    res.json(plans.map((plan) => formatPlan(plan, byId.get(plan.id))));
  } catch (err) { next(err); }
});

// POST /api/reading-plans/:id/start
router.post('/:id/start', async (req, res, next) => {
  try {
    const plan = await prisma.readingPlan.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!plan) return res.status(404).json({ message: 'Reading plan not found.' });

    const progress = await prisma.readingPlanProgress.upsert({
      where: { userId_planId: { userId: req.user.id, planId: plan.id } },
      create: { userId: req.user.id, planId: plan.id },
      update: {},
    });
    res.status(201).json(formatPlan(plan, progress));
  } catch (err) { next(err); }
});

// POST /api/reading-plans/:id/check-off — mark today's reading day complete
router.post('/:id/check-off', async (req, res, next) => {
  try {
    const plan = await prisma.readingPlan.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!plan) return res.status(404).json({ message: 'Reading plan not found.' });

    const progress = await prisma.readingPlanProgress.findUnique({
      where: { userId_planId: { userId: req.user.id, planId: plan.id } },
    });
    if (!progress) return res.status(400).json({ message: 'Start this reading plan before checking off a day.' });
    if (progress.lastCompletedDate === today()) {
      return res.json(formatPlan(plan, progress));
    }

    const completedDays = Array.isArray(progress.completedDays) ? [...progress.completedDays] : [];
    const nextDay = completedDays.length + 1;
    completedDays.push(nextDay);
    const finished = nextDay >= plan.durationDays;

    const updated = await prisma.readingPlanProgress.update({
      where: { id: progress.id },
      data: {
        completedDays,
        lastCompletedDate: today(),
        finishedAt: finished ? new Date() : null,
      },
    });
    res.json(formatPlan(plan, updated));
  } catch (err) { next(err); }
});

module.exports = router;
