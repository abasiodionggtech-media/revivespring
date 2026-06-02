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
    res.json(prayers);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
