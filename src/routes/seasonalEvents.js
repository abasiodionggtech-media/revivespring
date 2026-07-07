'use strict';
const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();

function formatEvent(event, challenges) {
  const today = new Date().toISOString().split('T')[0];
  return {
    id: event.id,
    key: event.key,
    title: event.titleEn,
    title_fr: event.titleFr,
    description: event.descriptionEn,
    icon: event.icon,
    start_date: event.startDate,
    end_date: event.endDate,
    is_current: event.isActive && today >= event.startDate && today <= event.endDate,
    challenges: challenges.map((c) => ({ id: c.id, title: c.titleEn, duration_days: c.durationDays })),
  };
}

// GET /api/seasonal-events — active/current events with their linked challenges
router.get('/', async (req, res, next) => {
  try {
    const events = await prisma.seasonalEvent.findMany({ where: { isActive: true }, orderBy: { startDate: 'asc' } });
    const eventIds = events.map((e) => e.id);
    const challenges = eventIds.length
      ? await prisma.challenge.findMany({ where: { eventId: { in: eventIds }, isActive: true } })
      : [];
    const challengesByEvent = new Map();
    challenges.forEach((c) => {
      const list = challengesByEvent.get(c.eventId) || [];
      list.push(c);
      challengesByEvent.set(c.eventId, list);
    });
    res.json(events.map((e) => formatEvent(e, challengesByEvent.get(e.id) || [])));
  } catch (err) { next(err); }
});

module.exports = router;
