const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(422).json({ message: e.array()[0].msg }); return true; }
  return false;
}

function mapEntry(e) {
  return {
    id: e.id,
    title: e.title,
    content: e.content,
    mood: e.mood,
    status: e.status,
    language: e.language,
    tags: e.tags,
    created_date: e.createdDate || e.createdAt.toISOString().split('T')[0],
  };
}

// GET /api/journal
router.get('/', async (req, res, next) => {
  try {
    const { status, tag } = req.query;
    const where = { userId: req.user.id };
    if (status) where.status = status;
    if (tag) where.tags = { has: tag };

    const entries = await prisma.journalEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(entries.map(mapEntry));
  } catch (err) { next(err); }
});

// POST /api/journal
router.post('/',
  [body('title').notEmpty().trim(), body('content').notEmpty().trim()],
  async (req, res, next) => {
    if (validate(req, res)) return;
    try {
      // Free plan: max 10 entries
      if (req.user.subscriptionStatus !== 'premium') {
        const count = await prisma.journalEntry.count({ where: { userId: req.user.id } });
        if (count >= 10) {
          return res.status(403).json({
            message: 'Free plan limit: 10 journal entries. Upgrade to Premium for unlimited.',
          });
        }
      }

      const today = new Date().toISOString().split('T')[0];
      const entry = await prisma.journalEntry.create({
        data: {
          userId: req.user.id,
          title: req.body.title,
          content: req.body.content,
          mood: req.body.mood,
          status: req.body.status || 'active',
          language: req.body.language || req.user.language,
          tags: req.body.tags || [],
          createdDate: today,
        },
      });
      res.status(201).json(mapEntry(entry));
    } catch (err) { next(err); }
  }
);

// PATCH /api/journal/:id
router.patch('/:id',
  [body('status').optional().isIn(['active', 'answered'])],
  async (req, res, next) => {
    if (validate(req, res)) return;
    try {
      const existing = await prisma.journalEntry.findFirst({
        where: { id: req.params.id, userId: req.user.id },
      });
      if (!existing) return res.status(404).json({ message: 'Entry not found.' });

      const data = {};
      if (req.body.title) data.title = req.body.title;
      if (req.body.content) data.content = req.body.content;
      if (req.body.status) data.status = req.body.status;
      if (req.body.tags) data.tags = req.body.tags;

      const entry = await prisma.journalEntry.update({
        where: { id: req.params.id },
        data,
      });

      // Update analytics for answered prayer
      if (req.body.status === 'answered' && existing.status !== 'answered') {
        await prisma.analytics.upsert({
          where: { userId: req.user.id },
          create: { userId: req.user.id, answeredPrayers: 1 },
          update: { answeredPrayers: { increment: 1 } },
        });
      }

      res.json(mapEntry(entry));
    } catch (err) { next(err); }
  }
);

// DELETE /api/journal/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.journalEntry.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!existing) return res.status(404).json({ message: 'Entry not found.' });
    await prisma.journalEntry.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
