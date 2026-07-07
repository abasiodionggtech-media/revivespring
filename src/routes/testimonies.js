'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function formatTestimony(item, currentUserId, reactedIds, countMap) {
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    is_mine: item.userId === currentUserId,
    is_anonymous: item.isAnonymous,
    author: item.isAnonymous ? null : (item.user?.fullName || 'A friend'),
    amen_count: countMap.get(item.id) || 0,
    reacted_by_me: reactedIds.has(item.id),
    created_at: item.createdAt,
  };
}

// GET /api/testimonies
router.get('/', async (req, res, next) => {
  try {
    const testimonies = await prisma.testimony.findMany({
      include: { user: { select: { fullName: true } }, _count: { select: { reactions: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const reactions = await prisma.testimonyReaction.findMany({
      where: { userId: req.user.id, testimonyId: { in: testimonies.map((t) => t.id) } },
      select: { testimonyId: true },
    });
    const reactedIds = new Set(reactions.map((r) => r.testimonyId));
    const countMap = new Map(testimonies.map((t) => [t.id, t._count.reactions]));
    res.json(testimonies.map((t) => formatTestimony(t, req.user.id, reactedIds, countMap)));
  } catch (err) { next(err); }
});

// POST /api/testimonies
router.post('/', [
  body('title').trim().notEmpty().isLength({ max: 100 }),
  body('content').trim().notEmpty().isLength({ max: 2000 }),
], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const testimony = await prisma.testimony.create({
      data: {
        userId: req.user.id,
        title: req.body.title,
        content: req.body.content,
        isAnonymous: req.body.is_anonymous === true,
      },
      include: { user: { select: { fullName: true } } },
    });
    res.status(201).json(formatTestimony({ ...testimony, _count: { reactions: 0 } }, req.user.id, new Set(), new Map()));
  } catch (err) { next(err); }
});

// POST /api/testimonies/:id/react — toggles the "Amen" reaction
router.post('/:id/react', async (req, res, next) => {
  try {
    const testimony = await prisma.testimony.findUnique({ where: { id: req.params.id } });
    if (!testimony) return res.status(404).json({ message: 'Testimony not found.' });

    const existing = await prisma.testimonyReaction.findUnique({
      where: { testimonyId_userId: { testimonyId: testimony.id, userId: req.user.id } },
    });
    if (existing) {
      await prisma.testimonyReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.testimonyReaction.create({ data: { testimonyId: testimony.id, userId: req.user.id } });
    }

    const count = await prisma.testimonyReaction.count({ where: { testimonyId: testimony.id } });
    res.json({ amen_count: count, reacted_by_me: !existing });
  } catch (err) { next(err); }
});

module.exports = router;
