'use strict';
const express = require('express');
const prisma  = require('../config/prisma');

const router = express.Router();

const formatVerse = verse => ({
  id: verse.id,
  verse: verse.verseEn,
  verse_fr: verse.verseFr,
  reference: verse.reference,
});

router.get('/', async (req, res, next) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let verse = await prisma.dailyVerse.findFirst({ where: { activeOn: today, isActive: true } });

    if (!verse) {
      const verses = await prisma.dailyVerse.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
      if (!verses.length) {
        return res.status(404).json({ message: 'No daily verses configured.' });
      }
      const index = new Date().getDate() % verses.length;
      verse = verses[index];
    }

    res.json(formatVerse(verse));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
