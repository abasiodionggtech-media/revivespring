'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();
const today = () => new Date().toISOString().split('T')[0];
const QUIZ_UNLOCK_DAYS = 7;

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function formatCard(card, progress) {
  const addedAt = progress?.addedAt ? new Date(progress.addedAt) : null;
  const daysSinceAdded = addedAt ? Math.floor((Date.now() - addedAt.getTime()) / 86400000) : null;
  return {
    id: card.id,
    reference: card.referenceEn,
    verse: card.verseEn,
    category: card.category,
    added: !!progress,
    review_count: progress?.reviewCount || 0,
    reviewed_today: progress ? progress.lastReviewedDate === today() : false,
    mastered: !!progress?.mastered,
    quiz_attempts: progress?.quizAttempts || 0,
    quiz_unlocked: progress ? (daysSinceAdded ?? 0) >= QUIZ_UNLOCK_DAYS && !progress.mastered : false,
    days_until_quiz: progress && !progress.mastered ? Math.max(0, QUIZ_UNLOCK_DAYS - (daysSinceAdded ?? 0)) : null,
  };
}

// GET /api/memory-cards
router.get('/', async (req, res, next) => {
  try {
    const [cards, progressRows] = await Promise.all([
      prisma.memoryCard.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.memoryCardProgress.findMany({ where: { userId: req.user.id } }),
    ]);
    const byId = new Map(progressRows.map((p) => [p.cardId, p]));
    res.json(cards.map((card) => formatCard(card, byId.get(card.id))));
  } catch (err) { next(err); }
});

// POST /api/memory-cards/:id/add — start memorizing this card
router.post('/:id/add', async (req, res, next) => {
  try {
    const card = await prisma.memoryCard.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!card) return res.status(404).json({ message: 'Memory card not found.' });

    const progress = await prisma.memoryCardProgress.upsert({
      where: { userId_cardId: { userId: req.user.id, cardId: card.id } },
      create: { userId: req.user.id, cardId: card.id },
      update: {},
    });
    res.status(201).json(formatCard(card, progress));
  } catch (err) { next(err); }
});

// POST /api/memory-cards/:id/review — mark reviewed today (flashcard flip)
router.post('/:id/review', async (req, res, next) => {
  try {
    const card = await prisma.memoryCard.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!card) return res.status(404).json({ message: 'Memory card not found.' });

    const progress = await prisma.memoryCardProgress.findUnique({
      where: { userId_cardId: { userId: req.user.id, cardId: card.id } },
    });
    if (!progress) return res.status(400).json({ message: 'Add this card before reviewing it.' });

    const updated = progress.lastReviewedDate === today()
      ? progress
      : await prisma.memoryCardProgress.update({
          where: { id: progress.id },
          data: { reviewCount: { increment: 1 }, lastReviewedDate: today() },
        });
    res.json(formatCard(card, updated));
  } catch (err) { next(err); }
});

// POST /api/memory-cards/:id/quiz — { passed: boolean } self-reported recall check after 7 days
router.post('/:id/quiz', [body('passed').isBoolean()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const card = await prisma.memoryCard.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!card) return res.status(404).json({ message: 'Memory card not found.' });

    const progress = await prisma.memoryCardProgress.findUnique({
      where: { userId_cardId: { userId: req.user.id, cardId: card.id } },
    });
    if (!progress) return res.status(400).json({ message: 'Add this card before quizzing on it.' });

    const updated = await prisma.memoryCardProgress.update({
      where: { id: progress.id },
      data: {
        quizAttempts: { increment: 1 },
        mastered: req.body.passed === true,
        quizPassedAt: req.body.passed === true ? new Date() : null,
      },
    });
    res.json(formatCard(card, updated));
  } catch (err) { next(err); }
});

module.exports = router;
