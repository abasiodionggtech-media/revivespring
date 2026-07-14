'use strict';

/**
 * Imports a public-domain Bible from a plain-text file into the database.
 *
 *   node scripts/import-bible.js KJV data/bible/kjv.txt
 *   node scripts/import-bible.js BSB data/bible/bsb.txt
 *
 * Safe to re-run: it wipes and re-imports that one translation, and leaves
 * every other translation untouched.
 *
 * The source files come from different projects and are not formatted the
 * same way, so the parser below is deliberately tolerant. It accepts, per line:
 *
 *   Genesis 1:1  In the beginning ...
 *   Gen 1:1	In the beginning ...
 *   Gen.1.1|In the beginning ...
 *   1 Samuel 3:4  ...        (books whose names start with a number)
 *
 * Anything it can't parse (headers, blank lines, copyright notices) is skipped
 * and reported at the end, so a bad line can't silently swallow whole chapters.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const prisma = require('../src/config/prisma');

// Canonical order, and every abbreviation the source files are likely to use.
const BOOKS = [
  ['Genesis', 1, ['gen', 'ge', 'gn']],
  ['Exodus', 2, ['exo', 'ex', 'exod']],
  ['Leviticus', 3, ['lev', 'le', 'lv']],
  ['Numbers', 4, ['num', 'nu', 'nm', 'nb']],
  ['Deuteronomy', 5, ['deu', 'dt', 'deut']],
  ['Joshua', 6, ['jos', 'jsh', 'josh']],
  ['Judges', 7, ['jdg', 'judg', 'jg']],
  ['Ruth', 8, ['rut', 'rth', 'ru']],
  ['1 Samuel', 9, ['1sa', '1sam', '1s', 'sa1']],
  ['2 Samuel', 10, ['2sa', '2sam', '2s', 'sa2']],
  ['1 Kings', 11, ['1ki', '1kgs', '1k', 'kg1', '1kin']],
  ['2 Kings', 12, ['2ki', '2kgs', '2k', 'kg2', '2kin']],
  ['1 Chronicles', 13, ['1ch', '1chr', '1chron', 'ch1']],
  ['2 Chronicles', 14, ['2ch', '2chr', '2chron', 'ch2']],
  ['Ezra', 15, ['ezr', 'ez']],
  ['Nehemiah', 16, ['neh', 'ne']],
  ['Esther', 17, ['est', 'esth', 'es']],
  ['Job', 18, ['job', 'jb']],
  ['Psalms', 19, ['psa', 'ps', 'psalm', 'psalms', 'pslm']],
  ['Proverbs', 20, ['pro', 'prov', 'pr', 'prv']],
  ['Ecclesiastes', 21, ['ecc', 'eccl', 'ec', 'qoh']],
  ['Song of Solomon', 22, ['sng', 'song', 'sos', 'ss', 'canticles', 'songofsolomon', 'songofsongs', 'sol']],
  ['Isaiah', 23, ['isa', 'is']],
  ['Jeremiah', 24, ['jer', 'je', 'jr']],
  ['Lamentations', 25, ['lam', 'la']],
  ['Ezekiel', 26, ['ezk', 'eze', 'ezek', 'eze']],
  ['Daniel', 27, ['dan', 'da', 'dn']],
  ['Hosea', 28, ['hos', 'ho']],
  ['Joel', 29, ['jol', 'joel', 'jl', 'joe']],
  ['Amos', 30, ['amo', 'am']],
  ['Obadiah', 31, ['oba', 'ob', 'obad']],
  ['Jonah', 32, ['jon', 'jnh']],
  ['Micah', 33, ['mic', 'mc']],
  ['Nahum', 34, ['nam', 'nah', 'na']],
  ['Habakkuk', 35, ['hab', 'hb']],
  ['Zephaniah', 36, ['zep', 'zeph', 'zp']],
  ['Haggai', 37, ['hag', 'hg']],
  ['Zechariah', 38, ['zec', 'zech', 'zc', 'zac']],
  ['Malachi', 39, ['mal', 'ml']],
  ['Matthew', 40, ['mat', 'matt', 'mt']],
  ['Mark', 41, ['mrk', 'mark', 'mk', 'mr', 'mar']],
  ['Luke', 42, ['luk', 'luke', 'lk']],
  ['John', 43, ['jhn', 'john', 'jn', 'joh']],
  ['Acts', 44, ['act', 'ac']],
  ['Romans', 45, ['rom', 'ro', 'rm']],
  ['1 Corinthians', 46, ['1co', '1cor', 'co1']],
  ['2 Corinthians', 47, ['2co', '2cor', 'co2']],
  ['Galatians', 48, ['gal', 'ga']],
  ['Ephesians', 49, ['eph', 'ep']],
  ['Philippians', 50, ['php', 'phil', 'pp', 'phi']],
  ['Colossians', 51, ['col', 'cl']],
  ['1 Thessalonians', 52, ['1th', '1thess', '1thes', 'th1']],
  ['2 Thessalonians', 53, ['2th', '2thess', '2thes', 'th2']],
  ['1 Timothy', 54, ['1ti', '1tim', 'ti1']],
  ['2 Timothy', 55, ['2ti', '2tim', 'ti2']],
  ['Titus', 56, ['tit', 'ti']],
  ['Philemon', 57, ['phm', 'phlm', 'philem', 'plm']],
  ['Hebrews', 58, ['heb', 'hb']],
  ['James', 59, ['jas', 'jam', 'jm', 'jam']],
  ['1 Peter', 60, ['1pe', '1pet', '1pt', 'pe1']],
  ['2 Peter', 61, ['2pe', '2pet', '2pt', 'pe2']],
  ['1 John', 62, ['1jn', '1jo', '1john', 'jo1']],
  ['2 John', 63, ['2jn', '2jo', '2john', 'jo2']],
  ['3 John', 64, ['3jn', '3jo', '3john', 'jo3']],
  ['Jude', 65, ['jud', 'jde', 'jde']],
  ['Revelation', 66, ['rev', 're', 'rv', 'revelation', 'apocalypse']],
];

// Build a lookup from every spelling/abbreviation → [canonicalName, order]
const LOOKUP = new Map();
for (const [name, order, abbrevs] of BOOKS) {
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  LOOKUP.set(key(name), [name, order]);
  for (const a of abbrevs) LOOKUP.set(key(a), [name, order]);
}

function findBook(raw) {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return LOOKUP.get(key) || null;
}

/**
 * Pulls "book chapter:verse text" out of one line, whatever the separators.
 * Returns null for anything that isn't a verse (headers, blank lines, notices).
 *
 * Handles all the shapes these files come in:
 *   Gen|1|1| In the beginning ...~      (pipe-delimited, trailing tilde)
 *   Genesis 1:1   In the beginning ...
 *   Gen 1:1	In the beginning ...
 *   1 Samuel 3:4  ...                   (book names starting with a digit)
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Book, then chapter, then verse, then text. The separators vary wildly, so
  // accept any of : . | tab or whitespace between the parts. A book name may
  // itself begin with a digit ("1 Samuel"), hence the optional leading [1-3].
  const m = trimmed.match(
    /^((?:[1-3]\s*)?[A-Za-z][A-Za-z\s.]*[0-9]?)\s*[|:.\s]\s*(\d+)\s*[|:.\s]\s*(\d+)\s*[|:.\s]\s*(.+)$/
  );
  if (!m) return null;

  const book = findBook(m[1]);
  if (!book) return null;

  const chapter = parseInt(m[2], 10);
  const verse = parseInt(m[3], 10);
  // Some datasets terminate each verse with a tilde — strip it, and collapse
  // any stray whitespace so the text renders cleanly.
  const text = m[4].replace(/~\s*$/, '').trim().replace(/\s+/g, ' ');
  if (!chapter || !verse || !text) return null;

  return { book: book[0], bookOrder: book[1], chapter, verse, text };
}

async function main() {
  const translation = (process.argv[2] || '').toUpperCase();
  const file = process.argv[3];

  if (!translation || !file) {
    console.error('Usage: node scripts/import-bible.js <TRANSLATION> <file.txt>');
    console.error('   e.g. node scripts/import-bible.js KJV data/bible/kjv.txt');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`✗ File not found: ${path.resolve(file)}`);
    process.exit(1);
  }

  console.log(`\n📖 Importing ${translation} from ${file}`);

  const rows = [];
  const skipped = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    const parsed = parseLine(line);
    if (parsed) rows.push({ translation, ...parsed });
    else if (line.trim()) skipped.push(`${lineNo}: ${line.trim().slice(0, 60)}`);
  }

  if (rows.length === 0) {
    console.error('✗ Parsed 0 verses. The file format may not be what we expect.');
    console.error('  First few unparsed lines:');
    skipped.slice(0, 5).forEach((s) => console.error('   ', s));
    process.exit(1);
  }

  console.log(`   Parsed ${rows.length} verses (${skipped.length} lines skipped)`);

  // Replace this translation only — other translations are left alone.
  const removed = await prisma.bibleVerse.deleteMany({ where: { translation } });
  if (removed.count) console.log(`   Cleared ${removed.count} existing ${translation} verses`);

  // Chunked, or Postgres chokes on a 31k-row insert.
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.bibleVerse.createMany({
      data: rows.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    process.stdout.write(`\r   Inserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  const books = new Set(rows.map((r) => r.book));
  console.log(`\n✅ ${translation}: ${rows.length} verses across ${books.size} books`);

  if (books.size !== 66) {
    console.warn(`⚠️  Expected 66 books but found ${books.size} — the file may be partial.`);
  }
  if (skipped.length > 20) {
    console.warn(`⚠️  ${skipped.length} lines were skipped. If that seems high, check the format:`);
    skipped.slice(0, 3).forEach((s) => console.warn('   ', s));
  }
}

main()
  .catch((e) => { console.error('\n✗ Import failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
