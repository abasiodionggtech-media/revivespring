'use strict';
const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function findPartnership(userId) {
  return prisma.accountabilityPartnership.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
  });
}

// GET /api/accountability/partner — current partner + their recent activity
router.get('/partner', async (req, res, next) => {
  try {
    const partnership = await findPartnership(req.user.id);
    if (!partnership) return res.json({ partner: null });

    const partnerId = partnership.userAId === req.user.id ? partnership.userBId : partnership.userAId;
    const [partner, analytics] = await Promise.all([
      prisma.user.findUnique({ where: { id: partnerId }, select: { fullName: true, id: true } }),
      prisma.analytics.findUnique({ where: { userId: partnerId } }),
    ]);
    if (!partner) return res.json({ partner: null });

    res.json({
      partner: {
        id: partner.id,
        name: partner.fullName,
        current_streak: analytics?.currentStreak || 0,
        last_active_date: analytics?.lastActiveDate || null,
      },
      partnership_since: partnership.createdAt,
    });
  } catch (err) { next(err); }
});

// POST /api/accountability/invite — generate a shareable code
router.post('/invite', async (req, res, next) => {
  try {
    const existingPartnership = await findPartnership(req.user.id);
    if (existingPartnership) {
      return res.status(409).json({ message: 'You already have an accountability partner.' });
    }
    const invite = await prisma.accountabilityInvite.create({
      data: { inviterId: req.user.id, inviteCode: generateCode() },
    });
    res.status(201).json({ invite_code: invite.inviteCode });
  } catch (err) { next(err); }
});

// POST /api/accountability/accept — { invite_code }
router.post('/accept', [body('invite_code').trim().notEmpty()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const existingPartnership = await findPartnership(req.user.id);
    if (existingPartnership) {
      return res.status(409).json({ message: 'You already have an accountability partner.' });
    }

    const invite = await prisma.accountabilityInvite.findUnique({
      where: { inviteCode: req.body.invite_code.toString().toUpperCase() },
    });
    if (!invite || invite.status !== 'pending') {
      return res.status(404).json({ message: 'Invalid or already-used invite code.' });
    }
    if (invite.inviterId === req.user.id) {
      return res.status(400).json({ message: "You can't accept your own invite." });
    }

    await prisma.$transaction([
      prisma.accountabilityInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted', acceptedBy: req.user.id, acceptedAt: new Date() },
      }),
      prisma.accountabilityPartnership.create({
        data: { userAId: invite.inviterId, userBId: req.user.id },
      }),
    ]);

    res.status(201).json({ message: 'Accountability partnership created.' });
  } catch (err) { next(err); }
});

// POST /api/accountability/nudge — { message? }
router.post('/nudge', async (req, res, next) => {
  try {
    const partnership = await findPartnership(req.user.id);
    if (!partnership) return res.status(400).json({ message: 'You do not have an accountability partner yet.' });

    const partnerId = partnership.userAId === req.user.id ? partnership.userBId : partnership.userAId;
    await prisma.accountabilityNudge.create({
      data: { fromUserId: req.user.id, toUserId: partnerId, message: req.body.message || null },
    });
    await prisma.notification.create({
      data: {
        userId: partnerId,
        type: 'accountability_nudge',
        title: 'A nudge from your accountability partner',
        body: req.body.message || `${req.user.fullName} is thinking of you today — how's your walk with God going?`,
      },
    }).catch(() => {});

    res.status(201).json({ message: 'Nudge sent.' });
  } catch (err) { next(err); }
});

module.exports = router;
