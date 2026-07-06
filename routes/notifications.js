const express = require('express');
const { body, validationResult } = require('express-validator');

const {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  upsertDeviceToken,
} = require('../services/supportStorage');

const router = express.Router();

function ok(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ message: errors.array()[0].msg });
    return false;
  }
  return true;
}

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

router.post('/device-token',
  [
    body('token').trim().isLength({ min: 20 }).withMessage('Device token is required.'),
    body('platform').optional().trim().isLength({ min: 2 }),
  ],
  async (req, res, next) => {
    if (!ok(req, res)) return;
    try {
      await upsertDeviceToken({
        userId: req.user.id,
        token: req.body.token,
        platform: req.body.platform || 'android',
      });
      res.json({ message: 'Device token registered.' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
