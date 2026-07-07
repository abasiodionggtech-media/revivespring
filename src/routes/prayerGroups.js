'use strict';
const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { isPremiumUser } = require('../services/monetization');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function generateJoinCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function requirePremium(req, res) {
  if (!isPremiumUser(req.user)) {
    res.status(403).json({ message: 'Prayer Groups is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    return true;
  }
  return false;
}

function formatGroup(group, memberCount, isMember) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    is_public: group.isPublic,
    join_code: group.joinCode,
    member_count: memberCount,
    is_member: isMember,
    created_at: group.createdAt,
  };
}

// GET /api/prayer-groups — browse public groups
router.get('/', async (req, res, next) => {
  if (requirePremium(req, res)) return;
  try {
    const groups = await prisma.prayerGroup.findMany({
      where: { isPublic: true },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const memberships = await prisma.prayerGroupMembership.findMany({
      where: { userId: req.user.id, groupId: { in: groups.map((g) => g.id) } },
      select: { groupId: true },
    });
    const memberOf = new Set(memberships.map((m) => m.groupId));
    res.json(groups.map((g) => formatGroup(g, g._count.members, memberOf.has(g.id))));
  } catch (err) { next(err); }
});

// POST /api/prayer-groups — create a group
router.post('/', [body('name').trim().notEmpty().isLength({ max: 80 })], async (req, res, next) => {
  if (requirePremium(req, res)) return;
  if (validate(req, res)) return;
  try {
    const group = await prisma.prayerGroup.create({
      data: {
        name: req.body.name,
        description: req.body.description || null,
        createdByUserId: req.user.id,
        isPublic: req.body.is_public !== false,
        joinCode: generateJoinCode(),
      },
    });
    await prisma.prayerGroupMembership.create({
      data: { groupId: group.id, userId: req.user.id, role: 'admin' },
    });
    res.status(201).json(formatGroup(group, 1, true));
  } catch (err) { next(err); }
});

// POST /api/prayer-groups/:id/join
router.post('/:id/join', async (req, res, next) => {
  if (requirePremium(req, res)) return;
  try {
    const group = await prisma.prayerGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ message: 'Prayer group not found.' });

    await prisma.prayerGroupMembership.upsert({
      where: { groupId_userId: { groupId: group.id, userId: req.user.id } },
      create: { groupId: group.id, userId: req.user.id },
      update: {},
    });
    const memberCount = await prisma.prayerGroupMembership.count({ where: { groupId: group.id } });
    res.json(formatGroup(group, memberCount, true));
  } catch (err) { next(err); }
});

// GET /api/prayer-groups/:id — detail: members + requests posted within the group
router.get('/:id', async (req, res, next) => {
  if (requirePremium(req, res)) return;
  try {
    const group = await prisma.prayerGroup.findUnique({ where: { id: req.params.id } });
    if (!group) return res.status(404).json({ message: 'Prayer group not found.' });

    const membership = await prisma.prayerGroupMembership.findUnique({
      where: { groupId_userId: { groupId: group.id, userId: req.user.id } },
    });
    if (!membership) return res.status(403).json({ message: 'Join this group to view its content.' });

    const [members, requests] = await Promise.all([
      prisma.prayerGroupMembership.findMany({
        where: { groupId: group.id },
        include: { user: { select: { fullName: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.prayerRequest.findMany({
        where: { groupId: group.id },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      ...formatGroup(group, members.length, true),
      members: members.map((m) => ({ name: m.user.fullName, role: m.role })),
      requests: requests.map((r) => ({
        id: r.id,
        text: r.text,
        author: r.isAnonymous ? null : r.user.fullName,
        prayer_count: r.prayerCount,
        created_at: r.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/prayer-groups/:id/requests — post a prayer request inside the group
router.post('/:id/requests', [body('text').trim().notEmpty().isLength({ max: 500 })], async (req, res, next) => {
  if (requirePremium(req, res)) return;
  if (validate(req, res)) return;
  try {
    const membership = await prisma.prayerGroupMembership.findUnique({
      where: { groupId_userId: { groupId: req.params.id, userId: req.user.id } },
    });
    if (!membership) return res.status(403).json({ message: 'Join this group before posting.' });

    const request = await prisma.prayerRequest.create({
      data: {
        userId: req.user.id,
        text: req.body.text,
        isAnonymous: req.body.is_anonymous === true,
        groupId: req.params.id,
      },
    });
    res.status(201).json({ id: request.id, text: request.text, prayer_count: 0, created_at: request.createdAt });
  } catch (err) { next(err); }
});

module.exports = router;
