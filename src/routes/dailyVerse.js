'use strict';
const express = require('express');
const prisma  = require('../config/prisma');

const router = express.Router();

const VERSION_FIELD = {
  NIV: 'verseEn',
  KJV: 'verseKjv',
  NLT: 'verseNlt',
  ESV: 'verseEsv',
};

function formatVerse(verse, version) {
  const field = VERSION_FIELD[version] || 'verseEn';
  return {
    id: verse.id,
    verse: verse[field] || verse.verseEn, // fall back to NIV wording if that translation isn't filled in yet
    verse_fr: verse.verseFr,
    reference: verse.reference,
    version: VERSION_FIELD[version] ? version : 'NIV',
  };
}

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

    res.json(formatVerse(verse, req.user.bibleVersion));
  } catch (err) {
    next(err);
  }
});

// GET /api/daily-verse/random — "Verse of the Moment": a fresh, non-deterministic
// pick each call, for the shake/tap gesture screen.
router.get('/random', async (req, res, next) => {
  try {
    const verses = await prisma.dailyVerse.findMany({ where: { isActive: true } });
    if (!verses.length) {
      return res.status(404).json({ message: 'No verses configured.' });
    }
    const verse = verses[Math.floor(Math.random() * verses.length)];
    res.json(formatVerse(verse, req.user.bibleVersion));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
