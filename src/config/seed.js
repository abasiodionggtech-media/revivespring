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

  console.log('\n✅  Seed complete!');
  console.log('   Demo login: demo@reviveme.app / password123');
}

seed()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
