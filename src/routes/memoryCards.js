'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();
const today = () => new Date().toISOString().split('T')[0];
const QUIZ_UNLOCK_DAYS = 7;
const PASS_THRESHOLD = 0.55; // word-overlap ratio required to count as "remembered"

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A dependency-free word-overlap similarity check — robust to small
 * differences in word order, punctuation, and capitalization, without
 * needing an NLP library. Returns a 0-1 ratio.
 */
function similarityRatio(attempt, actual) {
  const a = normalizeText(attempt);
  const b = normalizeText(actual);
  if (!a || !b) return 0;
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  const bagB = new Map();
  wordsB.forEach((w) => bagB.set(w, (bagB.get(w) || 0) + 1));
  let matched = 0;
  wordsA.forEach((w) => {
    const remaining = bagB.get(w) || 0;
    if (remaining > 0) {
      matched += 1;
      bagB.set(w, remaining - 1);
    }
  });
  return matched / Math.max(wordsA.length, wordsB.length);
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
    added_at: progress?.addedAt || null,
  };
}

async function findNextSuggestedCard(userId) {
  const [allCards, progressRows] = await Promise.all([
    prisma.memoryCard.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.memoryCardProgress.findMany({ where: { userId }, select: { cardId: true } }),
  ]);
  const addedIds = new Set(progressRows.map((p) => p.cardId));
  const next = allCards.find((c) => !addedIds.has(c.id));
  return next ? { id: next.id, reference: next.referenceEn, category: next.category } : null;
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

// GET /api/memory-cards/due — cards that just unlocked their 7-day recall
// check, for an auto-prompt when the user opens the app.
router.get('/due', async (req, res, next) => {
  try {
    const [cards, progressRows] = await Promise.all([
      prisma.memoryCard.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      prisma.memoryCardProgress.findMany({ where: { userId: req.user.id } }),
    ]);
    const byId = new Map(progressRows.map((p) => [p.cardId, p]));
    const due = cards
      .map((card) => formatCard(card, byId.get(card.id)))
      .filter((c) => c.added && c.quiz_unlocked);
    res.json(due);
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

// POST /api/memory-cards/:id/recall — { text } — the real 7-day recall
// check. The user types the verse from memory; we compare it against the
// actual text with a word-overlap similarity score rather than trusting a
// simple yes/no self-report. Always returns the correct verse text so the
// UI can show it either way, plus a suggested next card to keep going.
router.post('/:id/recall', [body('text').trim().notEmpty().isLength({ max: 1000 })], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const card = await prisma.memoryCard.findFirst({ where: { id: req.params.id, isActive: true } });
    if (!card) return res.status(404).json({ message: 'Memory card not found.' });

    const progress = await prisma.memoryCardProgress.findUnique({
      where: { userId_cardId: { userId: req.user.id, cardId: card.id } },
    });
    if (!progress) return res.status(400).json({ message: 'Add this card before recalling it.' });

    const similarity = similarityRatio(req.body.text.toString(), card.verseEn);
    const passed = similarity >= PASS_THRESHOLD;

    const updated = await prisma.memoryCardProgress.update({
      where: { id: progress.id },
      data: {
        quizAttempts: { increment: 1 },
        mastered: passed,
        quizPassedAt: passed ? new Date() : null,
      },
    });

    const nextSuggestedCard = passed ? await findNextSuggestedCard(req.user.id) : null;

    res.json({
      passed,
      similarity: Math.round(similarity * 100),
      card: formatCard(card, updated),
      next_suggested_card: nextSuggestedCard,
    });
  } catch (err) { next(err); }
});

// Kept for backward compatibility with older clients — a plain self-report.
// New clients should use POST /:id/recall instead.
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
