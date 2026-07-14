'use strict';

/**
 * Bible reading — deliberately FREE and open.
 *
 * No auth middleware, no plan check, no trial gate. The text is public domain
 * (KJV), it costs nothing to serve, and putting Scripture behind a paywall
 * would be a strange thing for this app to do.
 *
 * Translations are listed here rather than derived from the DB, so the app can
 * show "coming soon" for the ones we haven't imported yet.
 */

const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();

// The canonical 66, in order, with chapter counts — so the app can render the
// book/chapter picker instantly without hitting the database.
const BOOKS = [
  ['Genesis', 1, 50, 'Old Testament'], ['Exodus', 2, 40, 'Old Testament'],
  ['Leviticus', 3, 27, 'Old Testament'], ['Numbers', 4, 36, 'Old Testament'],
  ['Deuteronomy', 5, 34, 'Old Testament'], ['Joshua', 6, 24, 'Old Testament'],
  ['Judges', 7, 21, 'Old Testament'], ['Ruth', 8, 4, 'Old Testament'],
  ['1 Samuel', 9, 31, 'Old Testament'], ['2 Samuel', 10, 24, 'Old Testament'],
  ['1 Kings', 11, 22, 'Old Testament'], ['2 Kings', 12, 25, 'Old Testament'],
  ['1 Chronicles', 13, 29, 'Old Testament'], ['2 Chronicles', 14, 36, 'Old Testament'],
  ['Ezra', 15, 10, 'Old Testament'], ['Nehemiah', 16, 13, 'Old Testament'],
  ['Esther', 17, 10, 'Old Testament'], ['Job', 18, 42, 'Old Testament'],
  ['Psalms', 19, 150, 'Old Testament'], ['Proverbs', 20, 31, 'Old Testament'],
  ['Ecclesiastes', 21, 12, 'Old Testament'], ['Song of Solomon', 22, 8, 'Old Testament'],
  ['Isaiah', 23, 66, 'Old Testament'], ['Jeremiah', 24, 52, 'Old Testament'],
  ['Lamentations', 25, 5, 'Old Testament'], ['Ezekiel', 26, 48, 'Old Testament'],
  ['Daniel', 27, 12, 'Old Testament'], ['Hosea', 28, 14, 'Old Testament'],
  ['Joel', 29, 3, 'Old Testament'], ['Amos', 30, 9, 'Old Testament'],
  ['Obadiah', 31, 1, 'Old Testament'], ['Jonah', 32, 4, 'Old Testament'],
  ['Micah', 33, 7, 'Old Testament'], ['Nahum', 34, 3, 'Old Testament'],
  ['Habakkuk', 35, 3, 'Old Testament'], ['Zephaniah', 36, 3, 'Old Testament'],
  ['Haggai', 37, 2, 'Old Testament'], ['Zechariah', 38, 14, 'Old Testament'],
  ['Malachi', 39, 4, 'Old Testament'],
  ['Matthew', 40, 28, 'New Testament'], ['Mark', 41, 16, 'New Testament'],
  ['Luke', 42, 24, 'New Testament'], ['John', 43, 21, 'New Testament'],
  ['Acts', 44, 28, 'New Testament'], ['Romans', 45, 16, 'New Testament'],
  ['1 Corinthians', 46, 16, 'New Testament'], ['2 Corinthians', 47, 13, 'New Testament'],
  ['Galatians', 48, 6, 'New Testament'], ['Ephesians', 49, 6, 'New Testament'],
  ['Philippians', 50, 4, 'New Testament'], ['Colossians', 51, 4, 'New Testament'],
  ['1 Thessalonians', 52, 5, 'New Testament'], ['2 Thessalonians', 53, 3, 'New Testament'],
  ['1 Timothy', 54, 6, 'New Testament'], ['2 Timothy', 55, 4, 'New Testament'],
  ['Titus', 56, 3, 'New Testament'], ['Philemon', 57, 1, 'New Testament'],
  ['Hebrews', 58, 13, 'New Testament'], ['James', 59, 5, 'New Testament'],
  ['1 Peter', 60, 5, 'New Testament'], ['2 Peter', 61, 3, 'New Testament'],
  ['1 John', 62, 5, 'New Testament'], ['2 John', 63, 1, 'New Testament'],
  ['3 John', 64, 1, 'New Testament'], ['Jude', 65, 1, 'New Testament'],
  ['Revelation', 66, 22, 'New Testament'],
];

// Everything we might offer. `available` is recomputed from the DB on each
// request, so a translation lights up the moment it's imported — no code change.
const TRANSLATIONS = [
  { code: 'KJV',  name: 'King James Version',        year: 1611, note: 'The classic.' },
  { code: 'BSB',  name: 'Berean Standard Bible',     year: 2020, note: 'Modern and readable.' },
  { code: 'BRB',  name: "Berean Reader's Bible",     year: 2020, note: 'Plain, flowing English.' },
  { code: 'ASV',  name: 'American Standard Version', year: 1901, note: 'Precise and literal.' },
  { code: 'AKJV', name: 'American King James',       year: 1999, note: 'KJV in modern spelling.' },
  { code: 'ERV',  name: 'English Revised Version',   year: 1885, note: 'The first major KJV revision.' },
];

/** GET /api/bible/books — the 66 books, grouped, with chapter counts. */
router.get('/books', (req, res) => {
  res.json({
    books: BOOKS.map(([name, order, chapters, testament]) => ({
      name, order, chapters, testament,
    })),
  });
});

/** GET /api/bible/translations — which ones are live, which are still coming. */
router.get('/translations', async (req, res, next) => {
  try {
    const rows = await prisma.bibleVerse.groupBy({
      by: ['translation'],
      _count: { _all: true },
    });
    const counts = new Map(rows.map((r) => [r.translation, r._count._all]));

    res.json({
      translations: TRANSLATIONS.map((t) => ({
        ...t,
        available: (counts.get(t.code) || 0) > 0,
        verseCount: counts.get(t.code) || 0,
      })),
      default: 'KJV',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bible/:translation/:book/:chapter
 *   e.g. /api/bible/KJV/John/3
 * Returns the whole chapter, verses in order.
 */
router.get('/:translation/:book/:chapter', async (req, res, next) => {
  try {
    const translation = String(req.params.translation || 'KJV').toUpperCase();
    const book = decodeURIComponent(req.params.book || '');
    const chapter = parseInt(req.params.chapter, 10);

    const meta = BOOKS.find(([name]) => name.toLowerCase() === book.toLowerCase());
    if (!meta) {
      return res.status(404).json({ message: `Unknown book: ${book}` });
    }
    if (!chapter || chapter < 1 || chapter > meta[2]) {
      return res.status(404).json({ message: `${meta[0]} has ${meta[2]} chapters.` });
    }

    const verses = await prisma.bibleVerse.findMany({
      where: { translation, book: meta[0], chapter },
      orderBy: { verse: 'asc' },
      select: { verse: true, text: true },
    });

    if (verses.length === 0) {
      return res.status(404).json({
        message: `${translation} isn't available yet.`,
        code: 'TRANSLATION_NOT_IMPORTED',
      });
    }

    res.json({
      translation,
      book: meta[0],
      bookOrder: meta[1],
      chapter,
      totalChapters: meta[2],
      testament: meta[3],
      verses,
      // so the reader can render prev/next without extra round-trips
      prev: chapter > 1
        ? { book: meta[0], chapter: chapter - 1 }
        : previousBookLastChapter(meta[1]),
      next: chapter < meta[2]
        ? { book: meta[0], chapter: chapter + 1 }
        : nextBookFirstChapter(meta[1]),
    });
  } catch (err) {
    next(err);
  }
});

function previousBookLastChapter(order) {
  const prev = BOOKS.find(([, o]) => o === order - 1);
  return prev ? { book: prev[0], chapter: prev[2] } : null;
}

function nextBookFirstChapter(order) {
  const next = BOOKS.find(([, o]) => o === order + 1);
  return next ? { book: next[0], chapter: 1 } : null;
}

/** GET /api/bible/search?q=...&translation=KJV — plain text search. */
router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const translation = String(req.query.translation || 'KJV').toUpperCase();
    if (q.length < 3) {
      return res.status(422).json({ message: 'Search for at least 3 characters.' });
    }

    const results = await prisma.bibleVerse.findMany({
      where: {
        translation,
        text: { contains: q, mode: 'insensitive' },
      },
      orderBy: [{ bookOrder: 'asc' }, { chapter: 'asc' }, { verse: 'asc' }],
      take: 100,
      select: { book: true, chapter: true, verse: true, text: true },
    });

    res.json({ query: q, translation, count: results.length, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
