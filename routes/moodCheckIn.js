'use strict';
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

function mapLog(log) {
  return { id: log.id, mood: log.mood, note: log.note, date: log.date, created_at: log.createdAt };
}

// GET /api/mood-checkin/today — has the user already checked in today?
router.get('/today', async (req, res, next) => {
  try {
    const log = await prisma.moodLog.findUnique({
      where: { userId_date: { userId: req.user.id, date: today() } },
    });
    res.json({ checkedIn: !!log, log: log ? mapLog(log) : null });
  } catch (err) { next(err); }
});

// POST /api/mood-checkin — record (or update) today's check-in
router.post('/', [body('mood').notEmpty().trim()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const date = today();
    const log = await prisma.moodLog.upsert({
      where: { userId_date: { userId: req.user.id, date } },
      create: { userId: req.user.id, mood: req.body.mood, note: req.body.note || null, date },
      update: { mood: req.body.mood, note: req.body.note || null },
    });
    res.status(201).json(mapLog(log));
  } catch (err) { next(err); }
});

// GET /api/mood-checkin/history?days=30
router.get('/history', async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffDate = cutoff.toISOString().split('T')[0];
    const logs = await prisma.moodLog.findMany({
      where: { userId: req.user.id, date: { gte: cutoffDate } },
      orderBy: { date: 'desc' },
    });
    res.json(logs.map(mapLog));
  } catch (err) { next(err); }
});

module.exports = router;
