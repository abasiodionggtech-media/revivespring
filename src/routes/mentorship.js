'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { isPremiumUser } = require('../services/monetization');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function requirePremium(req, res) {
  if (!isPremiumUser(req.user)) {
    res.status(403).json({ message: 'Spiritual Mentorship is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    return true;
  }
  return false;
}

function formatMatch(match, currentUserId) {
  const isMentor = match.mentorUserId === currentUserId;
  return {
    id: match.id,
    status: match.status,
    role: isMentor ? 'mentor' : 'mentee',
    other_person: isMentor ? match.mentee?.fullName : match.mentor?.fullName,
    check_ins: Array.isArray(match.checkIns) ? match.checkIns : [],
    started_at: match.startedAt,
    created_at: match.createdAt,
  };
}

// POST /api/mentorship/profile — become available as a mentor
router.post('/profile', [body('bio').optional().isLength({ max: 600 })], async (req, res, next) => {
  if (requirePremium(req, res)) return;
  if (validate(req, res)) return;
  try {
    const profile = await prisma.mentorProfile.upsert({
      where: { userId: req.user.id },
      create: {
        userId: req.user.id,
        bio: req.body.bio || null,
        focusAreas: Array.isArray(req.body.focus_areas) ? req.body.focus_areas.slice(0, 8) : [],
        isAvailable: true,
      },
      update: {
        bio: req.body.bio || null,
        focusAreas: Array.isArray(req.body.focus_areas) ? req.body.focus_areas.slice(0, 8) : undefined,
        isAvailable: req.body.is_available !== false,
      },
    });
    res.status(201).json({ id: profile.id, bio: profile.bio, focus_areas: profile.focusAreas, is_available: profile.isAvailable });
  } catch (err) { next(err); }
});

// GET /api/mentorship/mentors — browse available mentors (excluding self)
router.get('/mentors', async (req, res, next) => {
  if (requirePremium(req, res)) return;
  try {
    const mentors = await prisma.mentorProfile.findMany({
      where: { isAvailable: true, userId: { not: req.user.id } },
      include: { user: { select: { id: true, fullName: true } } },
    });
    res.json(mentors.map((m) => ({
      mentor_user_id: m.userId,
      name: m.user.fullName,
      bio: m.bio,
      focus_areas: m.focusAreas,
    })));
  } catch (err) { next(err); }
});

// POST /api/mentorship/request — { mentor_user_id }
router.post('/request', [body('mentor_user_id').trim().notEmpty()], async (req, res, next) => {
  if (requirePremium(req, res)) return;
  if (validate(req, res)) return;
  try {
    const mentorUserId = req.body.mentor_user_id.toString();
    if (mentorUserId === req.user.id) {
      return res.status(400).json({ message: "You can't request yourself as a mentor." });
    }
    const match = await prisma.mentorshipMatch.upsert({
      where: { mentorUserId_menteeUserId: { mentorUserId, menteeUserId: req.user.id } },
      create: { mentorUserId, menteeUserId: req.user.id },
      update: {},
      include: { mentor: { select: { fullName: true } }, mentee: { select: { fullName: true } } },
    });
    res.status(201).json(formatMatch(match, req.user.id));
  } catch (err) { next(err); }
});

// GET /api/mentorship/my-matches — as mentor and as mentee
router.get('/my-matches', async (req, res, next) => {
  if (requirePremium(req, res)) return;
  try {
    const matches = await prisma.mentorshipMatch.findMany({
      where: { OR: [{ mentorUserId: req.user.id }, { menteeUserId: req.user.id }] },
      include: { mentor: { select: { fullName: true } }, mentee: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(matches.map((m) => formatMatch(m, req.user.id)));
  } catch (err) { next(err); }
});

// POST /api/mentorship/:matchId/respond — { accept: boolean } — mentor accepts/declines a request
router.post('/:matchId/respond', [body('accept').isBoolean()], async (req, res, next) => {
  if (requirePremium(req, res)) return;
  if (validate(req, res)) return;
  try {
    const match = await prisma.mentorshipMatch.findFirst({
      where: { id: req.params.matchId, mentorUserId: req.user.id },
    });
    if (!match) return res.status(404).json({ message: 'Mentorship request not found.' });

    const updated = await prisma.mentorshipMatch.update({
      where: { id: match.id },
      data: {
        status: req.body.accept ? 'active' : 'declined',
        startedAt: req.body.accept ? new Date() : null,
      },
      include: { mentor: { select: { fullName: true } }, mentee: { select: { fullName: true } } },
    });
    res.json(formatMatch(updated, req.user.id));
  } catch (err) { next(err); }
});

// POST /api/mentorship/:matchId/check-in — { note }
router.post('/:matchId/check-in', [body('note').trim().notEmpty().isLength({ max: 1000 })], async (req, res, next) => {
  if (requirePremium(req, res)) return;
  if (validate(req, res)) return;
  try {
    const match = await prisma.mentorshipMatch.findFirst({
      where: {
        id: req.params.matchId,
        status: 'active',
        OR: [{ mentorUserId: req.user.id }, { menteeUserId: req.user.id }],
      },
      include: { mentor: { select: { fullName: true } }, mentee: { select: { fullName: true } } },
    });
    if (!match) return res.status(404).json({ message: 'Active mentorship not found.' });

    const checkIns = Array.isArray(match.checkIns) ? [...match.checkIns] : [];
    checkIns.push({ date: new Date().toISOString(), note: req.body.note, byUserId: req.user.id });

    const updated = await prisma.mentorshipMatch.update({
      where: { id: match.id },
      data: { checkIns },
      include: { mentor: { select: { fullName: true } }, mentee: { select: { fullName: true } } },
    });
    res.json(formatMatch(updated, req.user.id));
  } catch (err) { next(err); }
});

module.exports = router;
