'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
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

// GET /api/daily-verse/backgrounds — lists whatever looping background
// videos are currently in public/media/verse-backgrounds/, so new ones can
// be added or swapped just by changing that folder — no code change needed.
router.get('/backgrounds', async (req, res, next) => {
  try {
    const dir = path.join(__dirname, '..', '..', 'public', 'media', 'verse-backgrounds');
    let files = [];
    try {
      files = await fs.readdir(dir);
    } catch (_err) {
      files = [];
    }
    const videos = files.filter((name) => /\.(mp4|webm|mov)$/i.test(name));
    res.json(videos.map((name) => ({
      name,
      url: `/media/verse-backgrounds/${encodeURIComponent(name)}`,
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
