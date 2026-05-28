'use strict';

/**
 * src/routes/admin.js
 * All routes require admin role via authenticateAdmin middleware.
 *
 * GET    /api/admin/stats              — dashboard overview numbers
 * GET    /api/admin/users              — paginated list of all users
 * GET    /api/admin/users/:id          — single user detail with counts
 * PATCH  /api/admin/users/:id          — edit user fields
 * DELETE /api/admin/users/:id          — delete user + all their data
 * PATCH  /api/admin/users/:id/role     — promote/demote admin role
 * PATCH  /api/admin/users/:id/verify   — manually verify user email
 * PATCH  /api/admin/users/:id/plan     — change subscription status
 * GET    /api/admin/prayers            — all prayers (paginated)
 * DELETE /api/admin/prayers/:id        — delete a prayer
 * GET    /api/admin/journal            — all journal entries (paginated)
 * DELETE /api/admin/journal/:id        — delete a journal entry
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma  = require('../config/prisma');
const { authenticateAdmin } = require('../middleware/adminAuth');

const router = express.Router();

// Apply admin auth to all routes in this file
router.use(authenticateAdmin);

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ message: errors.array()[0].msg });
    return true;
  }
  return false;
}

function safeUser(user) {
  const { passwordHash, otpCode, otpExpiresAt, ...safe } = user;
  return safe;
}

const PAGE_SIZE = 20;

/* ─── GET /api/admin/stats ───────────────────────────────────── */
router.get('/stats', async (req, res, next) => {
  try {
    const [
      totalUsers,
      verifiedUsers,
      adminUsers,
      premiumUsers,
      totalPrayers,
      totalJournal,
      totalGoals,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isEmailVerified: true } }),
      prisma.user.count({ where: { role: 'admin' } }),
      prisma.user.count({ where: { subscriptionStatus: 'premium' } }),
      prisma.prayer.count(),
      prisma.journalEntry.count(),
      prisma.dailyGoal.count(),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id:true, email:true, fullName:true, role:true, subscriptionStatus:true, isEmailVerified:true, createdAt:true },
      }),
    ]);

    res.json({
      totalUsers,
      verifiedUsers,
      unverifiedUsers: totalUsers - verifiedUsers,
      adminUsers,
      premiumUsers,
      freeUsers: totalUsers - premiumUsers,
      totalPrayers,
      totalJournal,
      totalGoals,
      recentUsers,
    });
  } catch (err) { next(err); }
});

/* ─── GET /api/admin/users ───────────────────────────────────── */
router.get('/users', async (req, res, next) => {
  try {
    const page    = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit   = Math.min(100, parseInt(req.query.limit || String(PAGE_SIZE), 10));
    const search  = (req.query.search || '').trim();
    const role    = req.query.role   || undefined;
    const plan    = req.query.plan   || undefined;

    const where = {};
    if (search) {
      where.OR = [
        { email:    { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (role) where.role = role;
    if (plan) where.subscriptionStatus = plan;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
        select: {
          id: true, email: true, fullName: true, role: true,
          subscriptionStatus: true, isEmailVerified: true,
          language: true, createdAt: true, updatedAt: true,
          _count: { select: { prayers: true, journals: true, dailyGoals: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

/* ─── GET /api/admin/users/:id ───────────────────────────────── */
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        analytics: true,
        _count: { select: { prayers: true, journals: true, dailyGoals: true } },
      },
    });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json(safeUser(user));
  } catch (err) { next(err); }
});

/* ─── PATCH /api/admin/users/:id ─────────────────────────────── */
router.patch('/users/:id',
  [
    body('full_name').optional().trim().notEmpty().withMessage('Name cannot be empty.'),
    body('email').optional().isEmail().normalizeEmail(),
    body('language').optional().isIn(['en','fr']),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 chars.'),
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const { full_name, email, language, password, salvationDate, testimony } = req.body;
      const data = {};
      if (full_name    !== undefined) data.fullName       = full_name;
      if (email        !== undefined) data.email          = email;
      if (language     !== undefined) data.language       = language;
      if (salvationDate!== undefined) data.salvationDate  = salvationDate;
      if (testimony    !== undefined) data.testimony      = testimony;
      if (password) data.passwordHash = await bcrypt.hash(password, 12);

      const user = await prisma.user.update({ where: { id: req.params.id }, data });
      res.json(safeUser(user));
    } catch (err) { next(err); }
  }
);

/* ─── DELETE /api/admin/users/:id ────────────────────────────── */
router.delete('/users/:id', async (req, res, next) => {
  try {
    // Prevent admin from deleting themselves
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your own admin account.' });
    }
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ─── PATCH /api/admin/users/:id/role ────────────────────────── */
router.patch('/users/:id/role',
  [ body('role').isIn(['user','admin']).withMessage('Role must be user or admin.') ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      if (req.params.id === req.user.id) {
        return res.status(400).json({ message: 'You cannot change your own role.' });
      }
      const user = await prisma.user.update({
        where: { id: req.params.id },
        data:  { role: req.body.role },
      });
      res.json(safeUser(user));
    } catch (err) { next(err); }
  }
);

/* ─── PATCH /api/admin/users/:id/verify ─────────────────────── */
router.patch('/users/:id/verify', async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data:  { isEmailVerified: true, otpCode: null, otpExpiresAt: null },
    });
    res.json(safeUser(user));
  } catch (err) { next(err); }
});

/* ─── PATCH /api/admin/users/:id/plan ───────────────────────── */
router.patch('/users/:id/plan',
  [ body('plan').isIn(['free','premium']).withMessage('Plan must be free or premium.') ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const user = await prisma.user.update({
        where: { id: req.params.id },
        data:  { subscriptionStatus: req.body.plan },
      });
      res.json(safeUser(user));
    } catch (err) { next(err); }
  }
);

/* ─── GET /api/admin/prayers ─────────────────────────────────── */
router.get('/prayers', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit || String(PAGE_SIZE), 10));
    const [prayers, total] = await Promise.all([
      prisma.prayer.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { email: true, fullName: true } } },
      }),
      prisma.prayer.count(),
    ]);
    res.json({ prayers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

/* ─── DELETE /api/admin/prayers/:id ──────────────────────────── */
router.delete('/prayers/:id', async (req, res, next) => {
  try {
    await prisma.prayer.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ─── GET /api/admin/journal ─────────────────────────────────── */
router.get('/journal', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit || String(PAGE_SIZE), 10));
    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { email: true, fullName: true } } },
      }),
      prisma.journalEntry.count(),
    ]);
    res.json({ entries, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

/* ─── DELETE /api/admin/journal/:id ──────────────────────────── */
router.delete('/journal/:id', async (req, res, next) => {
  try {
    await prisma.journalEntry.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
