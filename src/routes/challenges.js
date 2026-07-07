'use strict';
const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();
const today = () => new Date().toISOString().split('T')[0];

function formatChallenge(challenge, enrollment) {
  const completedDays = Array.isArray(enrollment?.completedDays) ? enrollment.completedDays : [];
  return {
    id: challenge.id,
    title: challenge.titleEn,
    title_fr: challenge.titleFr,
    description: challenge.descriptionEn,
    description_fr: challenge.descriptionFr,
    duration_days: challenge.durationDays,
    category: challenge.category,
    enrolled: !!enrollment,
    completed_days: completedDays,
    days_completed: completedDays.length,
    checked_in_today: enrollment ? enrollment.lastCompletedDate === today() : false,
    finished: !!enrollment?.finishedAt,
    started_at: enrollment?.startedAt || null,
  };
}

// GET /api/challenges — list all with the current user's enrollment status
router.get('/', async (req, res, next) => {
  try {
    const [challenges, enrollments] = await Promise.all([
      prisma.challenge.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.challengeEnrollment.findMany({ where: { userId: req.user.id } }),
    ]);
    const byId = new Map(enrollments.map((e) => [e.challengeId, e]));
    res.json(challenges.map((c) => formatChallenge(c, byId.get(c.id))));
  } catch (err) {
    next(err);
  }
});

// POST /api/challenges/:id/join
router.post('/:id/join', async (req, res, next) => {
  try {
    const challenge = await prisma.challenge.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!challenge) return res.status(404).json({ message: 'Challenge not found.' });

    const enrollment = await prisma.challengeEnrollment.upsert({
      where: { userId_challengeId: { userId: req.user.id, challengeId: challenge.id } },
      create: { userId: req.user.id, challengeId: challenge.id },
      update: {},
    });
    res.status(201).json(formatChallenge(challenge, enrollment));
  } catch (err) {
    next(err);
  }
});

// POST /api/challenges/:id/check-in — mark today's day complete
router.post('/:id/check-in', async (req, res, next) => {
  try {
    const challenge = await prisma.challenge.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!challenge) return res.status(404).json({ message: 'Challenge not found.' });

    const enrollment = await prisma.challengeEnrollment.findUnique({
      where: { userId_challengeId: { userId: req.user.id, challengeId: challenge.id } },
    });
    if (!enrollment) return res.status(400).json({ message: 'Join this challenge before checking in.' });
    if (enrollment.lastCompletedDate === today()) {
      return res.json(formatChallenge(challenge, enrollment));
    }

    const completedDays = Array.isArray(enrollment.completedDays) ? [...enrollment.completedDays] : [];
    const nextDay = completedDays.length + 1;
    completedDays.push(nextDay);
    const finished = nextDay >= challenge.durationDays;

    const updated = await prisma.challengeEnrollment.update({
      where: { id: enrollment.id },
      data: {
        completedDays,
        lastCompletedDate: today(),
        finishedAt: finished ? new Date() : null,
      },
    });
    res.json(formatChallenge(challenge, updated));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
