require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

async function seed() {
  console.log('🌱  Seeding ReviveMe database...');

  // ─── Demo User ───────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'demo@reviveme.app' },
    update: {},
    create: {
      email: 'demo@reviveme.app',
      passwordHash,
      fullName: 'Demo User',
      isEmailVerified: true,
      language: 'en',
      subscriptionStatus: 'premium',
    },
  });
  console.log('  ✓ Demo user created:', user.email);

  // ─── Analytics ───────────────────────────────────────────────────────────────
  await prisma.analytics.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      totalPrayers: 24,
      answeredPrayers: 8,
      currentStreak: 5,
      longestStreak: 12,
      lastActiveDate: new Date().toISOString().split('T')[0],
    },
    update: {},
  });
  console.log('  ✓ Analytics seeded');

  // ─── Sample Prayers ──────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const samplePrayers = [
    {
      mood: 'anxious',
      bibleVerse: 'Cast all your anxiety on Him because He cares for you.',
      bibleReference: '1 Peter 5:7',
      prayerText: 'Heavenly Father, I release every fear and worry into Your loving hands...',
      isSaved: true,
      createdDate: today,
    },
    {
      mood: 'grateful',
      bibleVerse: 'Give thanks in all circumstances.',
      bibleReference: '1 Thessalonians 5:18',
      prayerText: 'Lord Most High, today my heart overflows with gratitude...',
      isSaved: true,
      createdDate: today,
    },
    {
      mood: 'healing',
      bibleVerse: 'By His wounds we are healed.',
      bibleReference: 'Isaiah 53:5',
      prayerText: 'Healing Lord, I come to You in need of Your healing touch...',
      isSaved: false,
      createdDate: today,
    },
  ];

  for (const p of samplePrayers) {
    await prisma.prayer.create({
      data: { userId: user.id, ...p },
    });
  }
  console.log('  ✓ Sample prayers seeded');

  // ─── Journal Entries ─────────────────────────────────────────────────────────
  const journals = [
    {
      title: 'Healing for my mother',
      content: 'Lord I pray for my mother\'s health. She has been struggling...',
      tags: ['healing', 'family'],
      status: 'active',
      createdDate: today,
    },
    {
      title: 'Job Interview Tomorrow',
      content: 'Father please give me favor in my interview...',
      tags: ['work', 'guidance'],
      status: 'answered',
      createdDate: today,
    },
    {
      title: 'Gratitude for provision',
      content: 'God you have been so faithful this month...',
      tags: ['gratitude', 'finances'],
      status: 'active',
      createdDate: today,
    },
  ];

  for (const j of journals) {
    await prisma.journalEntry.create({
      data: { userId: user.id, language: 'en', ...j },
    });
  }
  console.log('  ✓ Journal entries seeded');

  // ─── Daily Goals ─────────────────────────────────────────────────────────────
  const goals = [
    { text: 'Pray for 10 minutes', completed: true, date: today },
    { text: 'Read a Bible chapter', completed: true, date: today },
    { text: 'Call a loved one', completed: false, date: today },
    { text: 'Give thanks for 5 things', completed: false, date: today },
  ];

  for (const g of goals) {
    await prisma.dailyGoal.create({
      data: { userId: user.id, language: 'en', ...g },
    });
  }
  console.log('  ✓ Daily goals seeded');

  // Admin-managed daily goal templates assigned automatically to each user.
  const templates = [
    { titleEn: 'Read Psalm 23', kind: 'scripture', contentEn: 'Read Psalm 23 slowly. Notice one phrase that brings you peace.', durationSeconds: 10, sortOrder: 1 },
    { titleEn: 'Pray for your family', kind: 'prayer', contentEn: 'Spend a quiet moment naming your family members before God.', durationSeconds: 60, sortOrder: 2 },
    { titleEn: 'Write one gratitude note', kind: 'reflection', contentEn: 'Write down one thing you are grateful for today.', durationSeconds: 10, sortOrder: 3 },
  ];
  for (const template of templates) {
    const exists = await prisma.dailyGoalTemplate.findFirst({ where: { titleEn: template.titleEn } });
    if (!exists) await prisma.dailyGoalTemplate.create({ data: template });
  }
  console.log('  ✓ Daily goal templates seeded');

  const verses = [
    ['The Lord is my shepherd; I shall not want.', 'Psalm 23:1'],
    ['I can do all things through Christ who strengthens me.', 'Philippians 4:13'],
    ['Trust in the Lord with all your heart.', 'Proverbs 3:5'],
    ['Be strong and courageous. Do not be afraid.', 'Joshua 1:9'],
    ['The Lord is close to the brokenhearted.', 'Psalm 34:18'],
  ];
  for (const [verseEn, reference] of verses) {
    const exists = await prisma.dailyVerse.findFirst({ where: { verseEn, reference } });
    if (!exists) await prisma.dailyVerse.create({ data: { verseEn, reference } });
  }
  console.log('  ✓ Daily verses seeded');

  const library = [
    { category:'morning', titleEn:'Morning Renewal', prayerEn:'Lord, align my heart with peace, wisdom, and courage today.', verseEn:'This is the day the Lord has made.', verseRef:'Psalm 118:24' },
    { category:'anxious', titleEn:'Anxiety Support', prayerEn:'Father, quiet my thoughts and steady my breathing in Your presence.', verseEn:'Cast all your anxiety on Him because He cares for you.', verseRef:'1 Peter 5:7' },
    { category:'healing', titleEn:'Healing', prayerEn:'Healing Lord, restore my body, mind, and relationships with Your grace.', verseEn:'The Lord is close to the brokenhearted.', verseRef:'Psalm 34:18' },
    { category:'family', titleEn:'Family', prayerEn:'Cover the people I love with unity, protection, and grace.', verseEn:'As for me and my house, we will serve the Lord.', verseRef:'Joshua 24:15' },
  ];
  for (const item of library) {
    const exists = await prisma.prayerLibraryItem.findFirst({ where: { titleEn:item.titleEn } });
    if (!exists) await prisma.prayerLibraryItem.create({ data:item });
  }
  console.log('  ✓ Prayer library seeded');

  const declarations = [
    { textEn: 'I am fearfully and wonderfully made, and God has a plan for my life.', category: 'identity' },
    { textEn: 'By His stripes, I am healed. Wholeness belongs to me today.', category: 'healing' },
    { textEn: 'My God shall supply all my needs according to His riches in glory.', category: 'provision' },
    { textEn: 'I was created for a purpose, and I will walk in it with courage.', category: 'purpose' },
    { textEn: 'No weapon formed against me shall prosper. I am protected and covered.', category: 'protection' },
    { textEn: 'I am more than a conqueror through Him who loves me.', category: 'identity' },
    { textEn: 'Today I choose peace over anxiety, because God is with me.', category: 'peace' },
  ];
  for (let i = 0; i < declarations.length; i += 1) {
    const item = declarations[i];
    const exists = await prisma.declaration.findFirst({ where: { textEn: item.textEn } });
    if (!exists) await prisma.declaration.create({ data: { ...item, sortOrder: i } });
  }
  console.log('  ✓ Prophetic declarations seeded');

  console.log('\n✅  Seed complete!');
  console.log('   Demo login: demo@reviveme.app / password123');
}

seed()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
