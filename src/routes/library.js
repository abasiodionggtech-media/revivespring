'use strict';
const express = require('express');
const prisma  = require('../config/prisma');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const prayers = await prisma.prayerLibraryItem.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    // Rotate the visible order so each app visit surfaces a fresh mix.
    for (let index = prayers.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [prayers[index], prayers[swap]] = [prayers[swap], prayers[index]];
    }
    res.json(prayers);
  } catch (err) {
    next(err);
  }
});

router.get('/random', async (req, res, next) => {
  try {
    const prayers = await prisma.prayerLibraryItem.findMany({ where: { isVisible: true } });
    if (!prayers.length) return res.status(404).json({ message: 'No prayers configured.' });
    res.json(prayers[Math.floor(Math.random() * prayers.length)]);
  } catch (err) { next(err); }
});

module.exports = router;
