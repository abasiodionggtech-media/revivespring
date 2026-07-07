'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();
const VALID_TYPES = ['water', 'daniel', 'partial', 'full', 'custom'];

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function formatFast(fast) {
  return {
    id: fast.id,
    fast_type: fast.fastType,
    goal_hours: fast.goalHours,
    started_at: fast.startedAt,
    ended_at: fast.endedAt,
    status: fast.status,
    notes: fast.notes,
  };
}

// GET /api/fasts — history, most recent first
router.get('/', async (req, res, next) => {
  try {
    const fasts = await prisma.fast.findMany({ where: { userId: req.user.id }, orderBy: { startedAt: 'desc' }, take: 50 });
    res.json(fasts.map(formatFast));
  } catch (err) { next(err); }
});

// GET /api/fasts/active — the current in-progress fast, if any
router.get('/active', async (req, res, next) => {
  try {
    const fast = await prisma.fast.findFirst({ where: { userId: req.user.id, status: 'active' }, orderBy: { startedAt: 'desc' } });
    res.json(fast ? formatFast(fast) : null);
  } catch (err) { next(err); }
});

// POST /api/fasts/start
router.post('/start', [
  body('fast_type').trim().notEmpty().custom((v) => VALID_TYPES.includes(v)).withMessage('Invalid fast type.'),
  body('goal_hours').optional().isInt({ min: 1, max: 240 }),
], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const existing = await prisma.fast.findFirst({ where: { userId: req.user.id, status: 'active' } });
    if (existing) {
      return res.status(409).json({ message: 'You already have an active fast. End it before starting a new one.' });
    }
    const fast = await prisma.fast.create({
      data: {
        userId: req.user.id,
        fastType: req.body.fast_type,
        goalHours: req.body.goal_hours || 24,
        notes: req.body.notes || null,
      },
    });
    res.status(201).json(formatFast(fast));
  } catch (err) { next(err); }
});

// POST /api/fasts/:id/end — { status: 'completed' | 'broken' }
router.post('/:id/end', [
  body('status').trim().isIn(['completed', 'broken']),
], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const fast = await prisma.fast.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!fast) return res.status(404).json({ message: 'Fast not found.' });
    if (fast.status !== 'active') return res.status(400).json({ message: 'This fast has already ended.' });

    const updated = await prisma.fast.update({
      where: { id: fast.id },
      data: { status: req.body.status, endedAt: new Date() },
    });
    res.json(formatFast(updated));
  } catch (err) { next(err); }
});

module.exports = router;
