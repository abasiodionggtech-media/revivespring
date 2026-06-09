const express = require('express');

const {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = require('../services/supportStorage');

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
    const items = await listNotifications(req.user.id, req.query.limit || 50);
    const unreadCount = await countUnreadNotifications(req.user.id);
    res.json({ notifications: items.map(mapNotification), unreadCount });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const count = await markNotificationRead(req.params.id, req.user.id);
    if (!count) return res.status(404).json({ message: 'Notification not found.' });
    res.json({ message: 'Notification marked as read.' });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await markAllNotificationsRead(req.user.id);
    res.json({ message: 'Notifications marked as read.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
