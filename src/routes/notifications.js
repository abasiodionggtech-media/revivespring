const express = require('express');

const prisma = require('../config/prisma');

const router = express.Router();

function mapNotification(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    metadata: item.metadata,
    readAt: item.readAt,
    createdAt: item.createdAt,
  };
}

router.get('/', async (req, res, next) => {
  try {
    const items = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Number(req.query.limit || 50)),
    });
    const unreadCount = await prisma.notification.count({ where: { userId: req.user.id, readAt: null } });
    res.json({ notifications: items.map(mapNotification), unreadCount });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const item = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.id },
      data: { readAt: new Date() },
    });
    if (!item.count) return res.status(404).json({ message: 'Notification not found.' });
    res.json({ message: 'Notification marked as read.' });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ message: 'Notifications marked as read.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
