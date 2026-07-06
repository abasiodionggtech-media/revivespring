// ══════════════════════════════════════════════════════════════════════════════
// prayers.js
// ══════════════════════════════════════════════════════════════════════════════
const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const prayerRouter = express.Router();

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(422).json({ message: e.array()[0].msg }); return true; }
  return false;
}

// GET /api/prayers
// GET /api/prayers?answered=true  — Answered Prayer Wall filter
prayerRouter.get('/', async (req, res, next) => {
  try {
    const where = { userId: req.user.id };
    if (req.query.answered === 'true') where.isAnswered = true;
    const prayers = await prisma.prayer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(prayers.map(p => ({
      id: p.id,
      mood: p.mood,
      encouragement: p.encouragement,
      bible_verse: p.bibleVerse,
      bible_reference: p.bibleReference,
      prayer_text: p.prayerText,
      action_step: p.actionStep,
      language: p.language,
      is_saved: p.isSaved,
      is_answered: p.isAnswered,
      testimony: p.testimony,
      answered_at: p.answeredAt,
      created_date: p.createdDate || p.createdAt.toISOString().split('T')[0],
    })));
  } catch (err) { next(err); }
});

// PATCH /api/prayers/:id/answered — mark/unmark a prayer as answered, with an optional testimony
prayerRouter.patch('/:id/answered',
  [body('is_answered').isBoolean()],
  async (req, res, next) => {
    if (validate(req, res)) return;
    try {
      const prayer = await prisma.prayer.findFirst({ where: { id: req.params.id, userId: req.user.id } });
      if (!prayer) return res.status(404).json({ message: 'Prayer not found.' });

      const isAnswered = req.body.is_answered;
      const updated = await prisma.prayer.update({
        where: { id: prayer.id },
        data: {
          isAnswered,
          testimony: isAnswered ? (req.body.testimony ?? prayer.testimony ?? null) : null,
          answeredAt: isAnswered ? new Date() : null,
        },
      });

      res.json({
        id: updated.id,
        is_answered: updated.isAnswered,
        testimony: updated.testimony,
        answered_at: updated.answeredAt,
      });
    } catch (err) { next(err); }
  }
);

// POST /api/prayers
prayerRouter.post('/',
  [body('mood').notEmpty(), body('prayer_text').notEmpty()],
  async (req, res, next) => {
    if (validate(req, res)) return;
    try {
      const { mood, encouragement, bible_verse, bible_reference, prayer_text, action_step, language, is_saved } = req.body;
      const today = new Date().toISOString().split('T')[0];

      const prayer = await prisma.prayer.create({
        data: {
          userId: req.user.id,
          mood,
          encouragement,
          bibleVerse: bible_verse,
          bibleReference: bible_reference,
          prayerText: prayer_text,
          actionStep: action_step,
          language: language || req.user.language,
          isSaved: is_saved || false,
          createdDate: today,
        },
      });

      // Update analytics
      await prisma.analytics.upsert({
        where: { userId: req.user.id },
        create: { userId: req.user.id, totalPrayers: 1 },
        update: { totalPrayers: { increment: 1 } },
      });

      res.status(201).json({
        id: prayer.id,
        mood: prayer.mood,
        encouragement: prayer.encouragement,
        bible_verse: prayer.bibleVerse,
        bible_reference: prayer.bibleReference,
        prayer_text: prayer.prayerText,
        action_step: prayer.actionStep,
        language: prayer.language,
        is_saved: prayer.isSaved,
        created_date: prayer.createdDate,
      });
    } catch (err) { next(err); }
  }
);

// POST /api/prayers/complete
// A prayer only counts after the user has kept it open long enough to engage.
prayerRouter.post('/complete',
  [body('mood').notEmpty(), body('prayer_text').notEmpty(), body('elapsed_seconds').isInt({ min: 10 })],
  async (req, res, next) => {
    if (validate(req, res)) return;
    try {
      const { mood, encouragement, bible_verse, bible_reference, prayer_text, action_step, language } = req.body;
      const createdDate = new Date().toISOString().split('T')[0];
      const existing = await prisma.prayer.findFirst({
        where: { userId: req.user.id, mood, prayerText: prayer_text },
      });

      if (existing) {
        return res.json({ recorded: false, duplicate: true, id: existing.id, created_date: existing.createdDate });
      }

      const prayer = await prisma.prayer.create({
        data: {
          userId: req.user.id, mood, encouragement, bibleVerse: bible_verse,
          bibleReference: bible_reference, prayerText: prayer_text, actionStep: action_step,
          language: language || req.user.language, createdDate,
        },
      });
      await prisma.analytics.upsert({
        where: { userId: req.user.id },
        create: { userId: req.user.id, totalPrayers: 1 },
        update: { totalPrayers: { increment: 1 } },
      });
      res.status(201).json({ recorded: true, id: prayer.id, created_date: createdDate });
    } catch (err) { next(err); }
  }
);

// DELETE /api/prayers/:id
prayerRouter.delete('/:id', async (req, res, next) => {
  try {
    const prayer = await prisma.prayer.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!prayer) return res.status(404).json({ message: 'Prayer not found.' });
    await prisma.prayer.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = prayerRouter;

// ══════════════════════════════════════════════════════════════════════════════
// Exporting separate routers from one file — require() the named exports below
// ══════════════════════════════════════════════════════════════════════════════

// Journal router (exported as a separate file below)
