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

function formatRequest(request, currentUserId, prayedIds) {
  return {
    id: request.id,
    text: request.text,
    category: request.category,
    status: request.status,
    prayer_count: request.prayerCount,
    is_mine: request.userId === currentUserId,
    is_anonymous: request.isAnonymous,
    author: request.isAnonymous ? null : (request.user?.fullName || 'A friend'),
    prayed_by_me: prayedIds.has(request.id),
    created_at: request.createdAt,
  };
}

// GET /api/prayer-chain — public feed (excludes group-only requests)
router.get('/', async (req, res, next) => {
  try {
    const requests = await prisma.prayerRequest.findMany({
      where: { groupId: null },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const prayed = await prisma.prayerRequestPray.findMany({
      where: { userId: req.user.id, requestId: { in: requests.map((r) => r.id) } },
      select: { requestId: true },
    });
    const prayedIds = new Set(prayed.map((p) => p.requestId));
    res.json(requests.map((r) => formatRequest(r, req.user.id, prayedIds)));
  } catch (err) { next(err); }
});

// POST /api/prayer-chain
router.post('/', [body('text').trim().notEmpty().isLength({ max: 500 })], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const request = await prisma.prayerRequest.create({
      data: {
        userId: req.user.id,
        text: req.body.text,
        category: req.body.category || 'general',
        isAnonymous: req.body.is_anonymous === true,
      },
      include: { user: { select: { fullName: true } } },
    });
    res.status(201).json(formatRequest(request, req.user.id, new Set()));
  } catch (err) { next(err); }
});

// POST /api/prayer-chain/:id/pray — "I prayed this," once per user
router.post('/:id/pray', async (req, res, next) => {
  try {
    const request = await prisma.prayerRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ message: 'Prayer request not found.' });

    const existing = await prisma.prayerRequestPray.findUnique({
      where: { requestId_userId: { requestId: request.id, userId: req.user.id } },
    });
    if (!existing) {
      await prisma.prayerRequestPray.create({ data: { requestId: request.id, userId: req.user.id } });
      await prisma.prayerRequest.update({ where: { id: request.id }, data: { prayerCount: { increment: 1 } } });
    }

    const updated = await prisma.prayerRequest.findUnique({
      where: { id: request.id },
      include: { user: { select: { fullName: true } } },
    });
    res.json(formatRequest(updated, req.user.id, new Set([request.id])));
  } catch (err) { next(err); }
});

// PATCH /api/prayer-chain/:id — owner marks their request answered
router.patch('/:id', [body('status').isIn(['active', 'answered'])], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const request = await prisma.prayerRequest.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!request) return res.status(404).json({ message: 'Prayer request not found.' });

    const updated = await prisma.prayerRequest.update({
      where: { id: request.id },
      data: { status: req.body.status },
      include: { user: { select: { fullName: true } } },
    });
    res.json(formatRequest(updated, req.user.id, new Set()));
  } catch (err) { next(err); }
});

module.exports = router;
