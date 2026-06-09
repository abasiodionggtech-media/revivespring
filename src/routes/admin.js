'use strict';

/**
 * src/routes/admin.js — Full admin API
 *
 * USERS
 *   GET    /api/admin/stats
 *   GET    /api/admin/users
 *   GET    /api/admin/users/:id
 *   PATCH  /api/admin/users/:id
 *   DELETE /api/admin/users/:id
 *   PATCH  /api/admin/users/:id/role
 *   PATCH  /api/admin/users/:id/verify
 *   PATCH  /api/admin/users/:id/plan
 *   PATCH  /api/admin/users/:id/disable
 *
 * PRAYER LIBRARY
 *   GET    /api/admin/library
 *   POST   /api/admin/library
 *   PATCH  /api/admin/library/:id
 *   DELETE /api/admin/library/:id
 *
 * DAILY VERSE
 *   GET    /api/admin/verse
 *   POST   /api/admin/verse
 *   PATCH  /api/admin/verse/:id
 *   DELETE /api/admin/verse/:id
 *
 * MENTAL HEALTH CONTENT
 *   GET    /api/admin/mental-health
 *   POST   /api/admin/mental-health
 *   PATCH  /api/admin/mental-health/:id
 *   DELETE /api/admin/mental-health/:id
 *
 * SALVATION CONTENT
 *   GET    /api/admin/salvation
 *   PATCH  /api/admin/salvation/:key
 *
 * APP SETTINGS
 *   GET    /api/admin/settings
 *   PATCH  /api/admin/settings/:key
 *
 * AI CONVERSATIONS
 *   GET    /api/admin/ai/conversations
 *   GET    /api/admin/ai/conversations/:id
 *   DELETE /api/admin/ai/conversations/:id
 *   GET    /api/admin/ai/knowledge
 *   POST   /api/admin/ai/knowledge
 *   PATCH  /api/admin/ai/knowledge/:id
 *   DELETE /api/admin/ai/knowledge/:id
 *
 * PRAYERS (user generated)
 *   GET    /api/admin/prayers
 *   DELETE /api/admin/prayers/:id
 *
 * JOURNAL
 *   GET    /api/admin/journal
 *   DELETE /api/admin/journal/:id
 *
 * DAILY GOAL TEMPLATES
 *   GET    /api/admin/goals
 *   POST   /api/admin/goals
 *   PATCH  /api/admin/goals/:id
 *   DELETE /api/admin/goals/:id
 *
 * DAILY EMAIL
 *   POST   /api/admin/email/test          — send test daily email to yourself
 *   POST   /api/admin/email/broadcast     — manual broadcast to all users
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const prisma  = require('../config/prisma');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { sendDailyPrayerEmail, sendSupportReplyEmail } = require('../services/email');
const {
  addAdminTicketReply,
  createNotification,
  findAdminTicket,
  listAdminTickets,
} = require('../services/supportStorage');

const router = express.Router();
router.use(authenticateAdmin);

const PAGE = 20;

function ok(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return false; }
  return true;
}
function safe(user) {
  const { passwordHash, otpCode, otpExpiresAt, ...s } = user; return s;
}
async function soft(promise, fallback) {
  try { return await promise; }
  catch { return fallback; }
}

/* ══════════════════════════════════════════════════════════
   STATS
══════════════════════════════════════════════════════════ */
router.get('/stats', async (req, res, next) => {
  try {
    const today    = new Date().toISOString().split('T')[0];
    const thisMonth= new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      totalUsers, verifiedUsers, adminUsers, premiumUsers, disabledUsers,
      totalPrayers, totalJournal, totalGoals,
      newUsersThisMonth, salvationUsers,
      recentUsers,
    ] = await Promise.all([
      soft(prisma.user.count(), 0),
      soft(prisma.user.count({ where: { isEmailVerified: true } }), 0),
      soft(prisma.user.count({ where: { role: 'admin' } }), 0),
      soft(prisma.user.count({ where: { subscriptionStatus: 'premium' } }), 0),
      soft(prisma.user.count({ where: { isDisabled: true } }), 0),
      soft(prisma.prayer.count(), 0),
      soft(prisma.journalEntry.count(), 0),
      soft(prisma.dailyGoal.count(), 0),
      soft(prisma.user.count({ where: { createdAt: { gte: thisMonth } } }), 0),
      soft(prisma.user.count({ where: { salvationPrayedAt: { not: null } } }), 0),
      soft(prisma.user.findMany({
        orderBy: { createdAt: 'desc' }, take: 5,
        select: { id:true, email:true, fullName:true, role:true, subscriptionStatus:true, isEmailVerified:true, createdAt:true },
      }), []),
    ]);

    const [dailyActiveUsers, topMoods] = await Promise.all([
      soft(prisma.analytics.count({ where: { lastActiveDate: today } }), 0),
      prisma.prayer.groupBy({
        by: ['mood'],
        _count: { mood: true },
        orderBy: { _count: { mood: 'desc' } },
        take: 5,
      }).catch(() => []),
    ]);

    res.json({
      totalUsers, verifiedUsers, unverifiedUsers: totalUsers - verifiedUsers,
      adminUsers, premiumUsers, freeUsers: totalUsers - premiumUsers,
      disabledUsers, newUsersThisMonth, salvationUsers, dailyActiveUsers,
      totalPrayers, totalJournal, totalGoals,
      conversionRate: totalUsers > 0 ? Math.round(premiumUsers / totalUsers * 100) : 0,
      topMoods: topMoods.map((item) => ({ mood: item.mood, count: item._count.mood })),
      recentUsers,
    });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   USERS
══════════════════════════════════════════════════════════ */
router.get('/users', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, parseInt(req.query.limit || String(PAGE), 10));
    const search = (req.query.search || '').trim();
    const where  = {};
    if (search) where.OR = [{ email: { contains: search, mode:'insensitive' } }, { fullName: { contains: search, mode:'insensitive' } }];
    if (req.query.role) where.role = req.query.role;
    if (req.query.plan) where.subscriptionStatus = req.query.plan;
    if (req.query.verified === 'true')  where.isEmailVerified = true;
    if (req.query.verified === 'false') where.isEmailVerified = false;

    let users = [];
    let total = 0;
    try {
      [users, total] = await Promise.all([
        prisma.user.findMany({
          where, orderBy: { createdAt: 'desc' },
          skip: (page-1)*limit, take: limit,
          select: {
            id:true, email:true, fullName:true, role:true, subscriptionStatus:true,
            isEmailVerified:true, isDisabled:true, language:true, dailyEmailEnabled:true,
            authProvider:true, profileImageUrl:true, salvationPrayedAt:true, createdAt:true, updatedAt:true,
            _count: { select: { prayers:true, journals:true, dailyGoals:true } },
          },
        }),
        prisma.user.count({ where }),
      ]);
    } catch {
      [users, total] = await Promise.all([
        prisma.user.findMany({
          where, orderBy: { createdAt: 'desc' },
          skip: (page-1)*limit, take: limit,
          select: {
            id:true, email:true, fullName:true, role:true, subscriptionStatus:true,
            isEmailVerified:true, isDisabled:true, language:true, createdAt:true, updatedAt:true, salvationPrayedAt:true,
            _count: { select: { prayers:true, journals:true, dailyGoals:true } },
          },
        }),
        prisma.user.count({ where }),
      ]);
      users = users.map((user) => ({
        ...user,
        dailyEmailEnabled: true,
        authProvider: 'email',
        profileImageUrl: null,
      }));
    }
    res.json({ users, pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
  } catch (err) { next(err); }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { analytics: true, _count: { select: { prayers:true, journals:true, dailyGoals:true } } },
    });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json(safe(user));
  } catch (err) { next(err); }
});

router.patch('/users/:id',
  [ body('full_name').optional().trim().notEmpty(), body('email').optional().isEmail().normalizeEmail(), body('language').optional().isIn(['en','fr']), body('password').optional().isLength({ min: 6 }), body('authProvider').optional().isIn(['email', 'google']) ],
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const { full_name, email, language, password, salvationDate, testimony, dailyEmailEnabled, authProvider, profileImageUrl } = req.body;
      const data = {};
      if (full_name !== undefined)          data.fullName           = full_name;
      if (email    !== undefined)           data.email              = email;
      if (language !== undefined)           data.language           = language;
      if (authProvider !== undefined)       data.authProvider       = authProvider;
      if (profileImageUrl !== undefined)    data.profileImageUrl    = profileImageUrl;
      if (salvationDate !== undefined)      data.salvationDate      = salvationDate;
      if (testimony !== undefined)          data.testimony          = testimony;
      if (dailyEmailEnabled !== undefined)  data.dailyEmailEnabled  = Boolean(dailyEmailEnabled);
      if (password)                         data.passwordHash       = await bcrypt.hash(password, 12);
      const user = await prisma.user.update({ where: { id: req.params.id }, data });
      res.json(safe(user));
    } catch (err) { next(err); }
  }
);

router.delete('/users/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ message: 'Cannot delete your own account.' });
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.patch('/users/:id/role',   [ body('role').isIn(['user','admin']) ], async (req, res, next) => {
  if (!ok(req, res)) return;
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ message: 'Cannot change your own role.' });
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role: req.body.role } });
    res.json(safe(user));
  } catch (err) { next(err); }
});

router.patch('/users/:id/verify', async (req, res, next) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isEmailVerified: true, otpCode: null, otpExpiresAt: null } });
    res.json(safe(user));
  } catch (err) { next(err); }
});

router.patch('/users/:id/plan',   [ body('plan').isIn(['free','premium']) ], async (req, res, next) => {
  if (!ok(req, res)) return;
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { subscriptionStatus: req.body.plan } });
    res.json(safe(user));
  } catch (err) { next(err); }
});

router.patch('/users/:id/disable', async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ message: 'Cannot disable your own account.' });
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isDisabled: !!(req.body.disabled) } });
    res.json(safe(user));
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   PRAYER LIBRARY
══════════════════════════════════════════════════════════ */
router.get('/library', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.category) where.category = req.query.category;
    if (req.query.premium === 'true')  where.isPremium = true;
    if (req.query.premium === 'false') where.isPremium = false;
    const items = await prisma.prayerLibraryItem.findMany({ where, orderBy: [{ category:'asc' }, { sortOrder:'asc' }] });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/library', async (req, res, next) => {
  try {
    const item = await prisma.prayerLibraryItem.create({ data: req.body });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.patch('/library/:id', async (req, res, next) => {
  try {
    const item = await prisma.prayerLibraryItem.update({ where: { id: req.params.id }, data: req.body });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/library/:id', async (req, res, next) => {
  try {
    await prisma.prayerLibraryItem.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   DAILY VERSE
══════════════════════════════════════════════════════════ */
router.get('/verse', async (req, res, next) => {
  try {
    const verses = await prisma.dailyVerse.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(verses);
  } catch (err) { next(err); }
});

router.post('/verse', async (req, res, next) => {
  try {
    const verse = await prisma.dailyVerse.create({ data: req.body });
    res.status(201).json(verse);
  } catch (err) { next(err); }
});

router.patch('/verse/:id', async (req, res, next) => {
  try {
    const verse = await prisma.dailyVerse.update({ where: { id: req.params.id }, data: req.body });
    res.json(verse);
  } catch (err) { next(err); }
});

router.delete('/verse/:id', async (req, res, next) => {
  try {
    await prisma.dailyVerse.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   MENTAL HEALTH CONTENT
══════════════════════════════════════════════════════════ */
router.get('/mental-health', async (req, res, next) => {
  try {
    const where = {};
    if (req.query.category) where.category = req.query.category;
    const items = await prisma.mentalHealthContent.findMany({ where, orderBy: [{ category:'asc' }, { sortOrder:'asc' }] });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/mental-health', async (req, res, next) => {
  try {
    const item = await prisma.mentalHealthContent.create({ data: req.body });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.patch('/mental-health/:id', async (req, res, next) => {
  try {
    const item = await prisma.mentalHealthContent.update({ where: { id: req.params.id }, data: req.body });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/mental-health/:id', async (req, res, next) => {
  try {
    await prisma.mentalHealthContent.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   SALVATION CONTENT
══════════════════════════════════════════════════════════ */
router.get('/salvation', async (req, res, next) => {
  try {
    const items = await prisma.salvationContent.findMany({ orderBy: { key: 'asc' } });
    res.json(items);
  } catch (err) { next(err); }
});

router.patch('/salvation/:key', async (req, res, next) => {
  try {
    const item = await prisma.salvationContent.upsert({
      where:  { key: req.params.key },
      update: req.body,
      create: { key: req.params.key, ...req.body },
    });
    res.json(item);
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   APP SETTINGS
══════════════════════════════════════════════════════════ */
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await prisma.appSetting.findMany({ orderBy: { key: 'asc' } });
    res.json(settings);
  } catch (err) { next(err); }
});

router.patch('/settings/:key', async (req, res, next) => {
  try {
    const setting = await prisma.appSetting.upsert({
      where:  { key: req.params.key },
      update: { value: String(req.body.value) },
      create: { key: req.params.key, value: String(req.body.value) },
    });
    res.json(setting);
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   AI CONVERSATIONS
══════════════════════════════════════════════════════════ */
router.get('/ai/conversations', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit || String(PAGE), 10));
    const [items, total] = await Promise.all([
      prisma.aiConversation.findMany({ orderBy: { updatedAt:'desc' }, skip:(page-1)*limit, take:limit }),
      prisma.aiConversation.count(),
    ]);
    res.json({ conversations: items, pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
  } catch (err) { next(err); }
});

router.get('/ai/conversations/:id', async (req, res, next) => {
  try {
    const item = await prisma.aiConversation.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: 'Not found.' });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/ai/conversations/:id', async (req, res, next) => {
  try {
    await prisma.aiConversation.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/ai/knowledge', async (req, res, next) => {
  try {
    const items = await prisma.aiKnowledgeBase.findMany({ orderBy: { category:'asc' } });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/ai/knowledge', async (req, res, next) => {
  try {
    const item = await prisma.aiKnowledgeBase.create({ data: req.body });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.patch('/ai/knowledge/:id', async (req, res, next) => {
  try {
    const item = await prisma.aiKnowledgeBase.update({ where: { id: req.params.id }, data: req.body });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/ai/knowledge/:id', async (req, res, next) => {
  try {
    await prisma.aiKnowledgeBase.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   USER PRAYERS (generated)
══════════════════════════════════════════════════════════ */
router.get('/prayers', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit || String(PAGE), 10));
    const [prayers, total] = await Promise.all([
      prisma.prayer.findMany({ orderBy: { createdAt:'desc' }, skip:(page-1)*limit, take:limit, include: { user: { select: { email:true, fullName:true } } } }),
      prisma.prayer.count(),
    ]);
    res.json({ prayers, pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
  } catch (err) { next(err); }
});

router.delete('/prayers/:id', async (req, res, next) => {
  try { await prisma.prayer.delete({ where: { id: req.params.id } }); res.status(204).end(); }
  catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   JOURNAL
══════════════════════════════════════════════════════════ */
router.get('/journal', async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit || String(PAGE), 10));
    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({ orderBy: { createdAt:'desc' }, skip:(page-1)*limit, take:limit, include: { user: { select: { email:true, fullName:true } } } }),
      prisma.journalEntry.count(),
    ]);
    res.json({ entries, pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
  } catch (err) { next(err); }
});

router.delete('/journal/:id', async (req, res, next) => {
  try { await prisma.journalEntry.delete({ where: { id: req.params.id } }); res.status(204).end(); }
  catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   DAILY GOAL TEMPLATES
══════════════════════════════════════════════════════════ */
router.get('/goals', async (req, res, next) => {
  try {
    const items = await prisma.dailyGoalTemplate.findMany({ orderBy: [{ sortOrder:'asc' }, { createdAt:'asc' }] });
    res.json(items);
  } catch (err) { next(err); }
});

router.post('/goals', async (req, res, next) => {
  try {
    const item = await prisma.dailyGoalTemplate.create({ data: req.body });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.patch('/goals/:id', async (req, res, next) => {
  try {
    const item = await prisma.dailyGoalTemplate.update({ where: { id:req.params.id }, data:req.body });
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/goals/:id', async (req, res, next) => {
  try {
    await prisma.dailyGoalTemplate.delete({ where: { id:req.params.id } });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   DAILY EMAIL TOOLS
══════════════════════════════════════════════════════════ */
router.post('/email/test', async (req, res, next) => {
  try {
    const prayer = {
      mood: 'grateful', verse: "Give thanks to the Lord, for he is good.", ref: "Psalm 107:1",
      prayer: "Father, thank You for this test. Your grace is real. In Jesus' name, Amen.",
      action: "Take a moment to breathe and thank God for one thing right now.",
    };
    await sendDailyPrayerEmail(req.user.email, req.user.fullName || 'Admin', prayer, req.user.language || 'en');
    res.json({ message: 'Test email sent to ' + req.user.email });
  } catch (err) { next(err); }
});

router.post('/email/broadcast', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { isEmailVerified: true, isDisabled: false, dailyEmailEnabled: true },
      select: { email:true, fullName:true, language:true },
    });
    const prayer = req.body.prayer || {
      mood: 'hopeful', verse: "For I know the plans I have for you, declares the Lord.", ref: "Jeremiah 29:11",
      prayer: "Lord, thank You for Your faithful plans for each of us. We trust You today. Amen.",
      action: "Share this prayer with one person who needs hope today.",
    };
    let sent = 0, failed = 0;
    for (const user of users) {
      try {
        await sendDailyPrayerEmail(user.email, user.fullName, prayer, user.language || 'en');
        sent++;
      } catch { failed++; }
    }
    res.json({ message: 'Broadcast complete.', sent, failed, total: users.length });
  } catch (err) { next(err); }
});

router.get('/support/tickets', async (req, res, next) => {
  try {
    const tickets = await listAdminTickets({
      status: req.query.status,
      limit: req.query.limit || 50,
    });
    res.json({ tickets });
  } catch (err) { next(err); }
});

router.post('/support/tickets/:id/reply',
  [body('message').trim().isLength({ min: 2 }).withMessage('Reply message is required.')],
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      const ticket = await findAdminTicket(req.params.id);
      if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });

      const updated = await addAdminTicketReply({
        ticket,
        admin: req.user,
        message: req.body.message,
        status: req.body.status || 'answered',
      });

      await createNotification({
        userId: ticket.userId,
        type: 'support_reply',
        title: 'Customer care replied',
        body: req.body.message,
        metadata: { ticketId: ticket.id, subject: ticket.subject },
      });

      try {
        await sendSupportReplyEmail(ticket.user.email, ticket.user.fullName, ticket, req.body.message);
      } catch (err) {
        console.error(`[EMAIL] Support reply email failed for ${ticket.user.email}:`, err.message);
      }

      res.json(updated);
    } catch (err) { next(err); }
  }
);

module.exports = router;
