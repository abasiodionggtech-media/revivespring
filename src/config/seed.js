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
    {
      verseEn: 'The Lord is my shepherd; I shall not want.',
      verseKjv: 'The Lord is my shepherd; I shall not want.',
      verseNlt: 'The Lord is my shepherd; I have all that I need.',
      verseEsv: 'The Lord is my shepherd; I shall not want.',
      reference: 'Psalm 23:1',
    },
    {
      verseEn: 'I can do all this through him who gives me strength.',
      verseKjv: 'I can do all things through Christ which strengtheneth me.',
      verseNlt: 'For I can do everything through Christ, who gives me strength.',
      verseEsv: 'I can do all things through him who strengthens me.',
      reference: 'Philippians 4:13',
    },
    {
      verseEn: 'Trust in the Lord with all your heart and lean not on your own understanding.',
      verseKjv: 'Trust in the Lord with all thine heart; and lean not unto thine own understanding.',
      verseNlt: 'Trust in the Lord with all your heart; do not depend on your own understanding.',
      verseEsv: 'Trust in the Lord with all your heart, and do not lean on your own understanding.',
      reference: 'Proverbs 3:5',
    },
    {
      verseEn: 'Be strong and courageous. Do not be afraid; do not be discouraged.',
      verseKjv: 'Be strong and of a good courage; be not afraid, neither be thou dismayed.',
      verseNlt: 'Be strong and courageous! Do not be afraid or discouraged.',
      verseEsv: 'Be strong and courageous. Do not be frightened, and do not be dismayed.',
      reference: 'Joshua 1:9',
    },
    {
      verseEn: 'The Lord is close to the brokenhearted and saves those who are crushed in spirit.',
      verseKjv: 'The Lord is nigh unto them that are of a broken heart; and saveth such as be of a contrite spirit.',
      verseNlt: 'The Lord is close to the brokenhearted; he rescues those whose spirits are crushed.',
      verseEsv: 'The Lord is near to the brokenhearted and saves the crushed in spirit.',
      reference: 'Psalm 34:18',
    },
  ];
  for (const item of verses) {
    const exists = await prisma.dailyVerse.findFirst({ where: { reference: item.reference } });
    if (!exists) {
      await prisma.dailyVerse.create({ data: item });
    } else if (!exists.verseKjv || !exists.verseNlt || !exists.verseEsv) {
      // Backfill translation fields for verses seeded before multi-version support existed.
      await prisma.dailyVerse.update({ where: { id: exists.id }, data: item });
    }
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

  const challenges = [
    { titleEn: '7 Days of Gratitude', descriptionEn: 'A short challenge to notice and give thanks for God\'s goodness every day.', durationDays: 7, category: 'gratitude', sortOrder: 0 },
    { titleEn: '21 Days of Peace', descriptionEn: 'Three weeks of daily prayer focused on releasing anxiety and receiving God\'s peace.', durationDays: 21, category: 'peace', sortOrder: 1 },
    { titleEn: '30 Days Closer to God', descriptionEn: 'A full month of consistent daily prayer to deepen your walk with God.', durationDays: 30, category: 'general', sortOrder: 2 },
  ];
  for (const item of challenges) {
    const exists = await prisma.challenge.findFirst({ where: { titleEn: item.titleEn } });
    if (!exists) await prisma.challenge.create({ data: item });
  }
  console.log('  ✓ Prayer challenges seeded');

  const readingPlans = [
    {
      titleEn: 'Psalms of Comfort',
      descriptionEn: 'Seven days in the Psalms that speak peace over anxiety and grief.',
      durationDays: 7,
      days: [
        { day: 1, referenceEn: 'Psalm 23', titleEn: 'The Lord is my shepherd' },
        { day: 2, referenceEn: 'Psalm 34:1-10', titleEn: 'Taste and see' },
        { day: 3, referenceEn: 'Psalm 46', titleEn: 'God is our refuge and strength' },
        { day: 4, referenceEn: 'Psalm 91', titleEn: 'Under His wings' },
        { day: 5, referenceEn: 'Psalm 121', titleEn: 'My help comes from the Lord' },
        { day: 6, referenceEn: 'Psalm 139:1-18', titleEn: 'Fearfully and wonderfully made' },
        { day: 7, referenceEn: 'Psalm 145', titleEn: 'Great is the Lord' },
      ],
      sortOrder: 0,
    },
    {
      titleEn: 'The Life of Jesus',
      descriptionEn: 'A five-day introduction to the ministry of Jesus in the Gospel of Luke.',
      durationDays: 5,
      days: [
        { day: 1, referenceEn: 'Luke 2:1-20', titleEn: 'The birth of Jesus' },
        { day: 2, referenceEn: 'Luke 4:1-13', titleEn: 'Tempted in the wilderness' },
        { day: 3, referenceEn: 'Luke 5:1-11', titleEn: 'The first disciples' },
        { day: 4, referenceEn: 'Luke 15:11-32', titleEn: 'The prodigal son' },
        { day: 5, referenceEn: 'Luke 24:1-12', titleEn: 'The resurrection' },
      ],
      sortOrder: 1,
    },
  ];
  for (const item of readingPlans) {
    const exists = await prisma.readingPlan.findFirst({ where: { titleEn: item.titleEn } });
    if (!exists) await prisma.readingPlan.create({ data: item });
  }
  console.log('  ✓ Bible reading plans seeded');

  const milestones = [
    { key: 'first_prayer', titleEn: 'First Prayer', descriptionEn: 'Completed your first prayer.', icon: 'favorite', criteriaType: 'prayers_total', criteriaValue: 1, sortOrder: 0 },
    { key: 'prayers_25', titleEn: 'Faithful in Prayer', descriptionEn: 'Completed 25 prayers.', icon: 'favorite', criteriaType: 'prayers_total', criteriaValue: 25, sortOrder: 1 },
    { key: 'prayers_100', titleEn: 'Prayer Warrior', descriptionEn: 'Completed 100 prayers.', icon: 'military_tech', criteriaType: 'prayers_total', criteriaValue: 100, sortOrder: 2 },
    { key: 'streak_7', titleEn: 'One Week Strong', descriptionEn: 'Kept a 7-day prayer streak.', icon: 'local_fire_department', criteriaType: 'streak', criteriaValue: 7, sortOrder: 3 },
    { key: 'streak_30', titleEn: 'Unshakeable', descriptionEn: 'Kept a 30-day prayer streak.', icon: 'local_fire_department', criteriaType: 'streak', criteriaValue: 30, sortOrder: 4 },
    { key: 'goals_30', titleEn: 'Goal Getter', descriptionEn: 'Completed 30 daily goals.', icon: 'check_circle', criteriaType: 'goals_total', criteriaValue: 30, sortOrder: 5 },
    { key: 'journal_10', titleEn: 'Reflective Heart', descriptionEn: 'Wrote 10 journal entries.', icon: 'edit_note', criteriaType: 'journal_total', criteriaValue: 10, sortOrder: 6 },
    { key: 'fast_1', titleEn: 'First Fast', descriptionEn: 'Completed your first fast.', icon: 'no_food', criteriaType: 'fasts_total', criteriaValue: 1, sortOrder: 7 },
    { key: 'challenge_1', titleEn: 'Challenge Finisher', descriptionEn: 'Completed a full prayer challenge.', icon: 'emoji_events', criteriaType: 'challenges_total', criteriaValue: 1, sortOrder: 8 },
    { key: 'reading_plan_1', titleEn: 'Scripture Explorer', descriptionEn: 'Completed a full Bible reading plan.', icon: 'menu_book', criteriaType: 'reading_plans_total', criteriaValue: 1, sortOrder: 9 },
  ];
  for (const item of milestones) {
    const exists = await prisma.milestone.findFirst({ where: { key: item.key } });
    if (!exists) await prisma.milestone.create({ data: item });
  }
  console.log('  ✓ Faith milestones seeded');

  const memoryCards = [
    { referenceEn: 'John 3:16', verseEn: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.', category: 'salvation', sortOrder: 0 },
    { referenceEn: 'Philippians 4:6-7', verseEn: 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God.', category: 'peace', sortOrder: 1 },
    { referenceEn: 'Jeremiah 29:11', verseEn: '"For I know the plans I have for you," declares the Lord, "plans to prosper you and not to harm you, plans to give you hope and a future."', category: 'hope', sortOrder: 2 },
    { referenceEn: 'Romans 8:28', verseEn: 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.', category: 'trust', sortOrder: 3 },
    { referenceEn: 'Proverbs 3:5-6', verseEn: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.', category: 'trust', sortOrder: 4 },
    { referenceEn: 'Isaiah 41:10', verseEn: 'So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you.', category: 'strength', sortOrder: 5 },
    { referenceEn: 'Psalm 46:1', verseEn: 'God is our refuge and strength, an ever-present help in trouble.', category: 'strength', sortOrder: 6 },
  ];
  for (const item of memoryCards) {
    const exists = await prisma.memoryCard.findFirst({ where: { referenceEn: item.referenceEn } });
    if (!exists) await prisma.memoryCard.create({ data: item });
  }
  console.log('  ✓ Scripture memory cards seeded');

  const worshipTracks = [
    { titleEn: 'Way Maker', artist: 'Sinach', platform: 'youtube', url: 'https://www.youtube.com/watch?v=m0I3GzZjxJM', category: 'praise', durationLabel: '5:32', sortOrder: 0 },
    { titleEn: '10,000 Reasons (Bless the Lord)', artist: 'Matt Redman', platform: 'youtube', url: 'https://www.youtube.com/watch?v=XtwIT8JjddM', category: 'worship', durationLabel: '4:17', sortOrder: 1 },
    { titleEn: 'Oceans (Where Feet May Fail)', artist: 'Hillsong UNITED', platform: 'youtube', url: 'https://www.youtube.com/watch?v=dy9nwe9_xzw', category: 'worship', durationLabel: '8:56', sortOrder: 2 },
    { titleEn: 'Goodness of God (Live)', artist: 'Bethel Music & Jenn Johnson', platform: 'youtube', url: 'https://www.youtube.com/watch?v=n0FBb6hnwTo', category: 'worship', durationLabel: '6:23', sortOrder: 3 },
    { titleEn: 'What A Beautiful Name', artist: 'Hillsong Worship', platform: 'youtube', url: 'https://www.youtube.com/watch?v=nQWFzMvCfLE', category: 'praise', durationLabel: '5:15', sortOrder: 4 },
  ];
  for (const item of worshipTracks) {
    const exists = await prisma.worshipTrack.findFirst({ where: { titleEn: item.titleEn, artist: item.artist } });
    if (!exists) await prisma.worshipTrack.create({ data: item });
  }
  console.log('  ✓ Worship tracks seeded');

  const griefContent = [
    {
      category: 'grief',
      titleEn: 'When grief feels heavier than words',
      contentEn: 'Grief is not a sign of weak faith — it is love with nowhere to go. Even Jesus wept at the tomb of a friend He was about to raise from the dead (John 11:35). It is safe to grieve honestly here, one moment at a time, without rushing yourself toward feeling better.',
      isPremium: false,
      sortOrder: 0,
    },
    {
      category: 'grief',
      titleEn: 'A prayer for the heavy days',
      contentEn: 'Lord, my heart is heavy and I do not have the words to explain it fully. Thank You for being close to the brokenhearted (Psalm 34:18). Help me be gentle with myself today, and let me feel Your presence even when I cannot feel much else.',
      isPremium: false,
      sortOrder: 1,
    },
    {
      category: 'grief',
      titleEn: "You don't have to carry this alone",
      contentEn: 'If grief has been sitting with you for a long time, or if it comes with thoughts that frighten you, please reach out to someone — a trusted person in your life, a counselor, or one of the crisis resources below. Asking for help is not a failure of faith; it is wisdom.',
      isPremium: false,
      sortOrder: 2,
    },
  ];
  for (const item of griefContent) {
    const exists = await prisma.mentalHealthContent.findFirst({ where: { category: item.category, titleEn: item.titleEn } });
    if (!exists) await prisma.mentalHealthContent.create({ data: item });
  }
  console.log('  ✓ Grief & crisis support content seeded');

  const seasonalEvents = [
    { key: 'christmas_2026', titleEn: 'Christmas Season', descriptionEn: 'Celebrate the birth of Jesus with daily readings and prayers of hope.', icon: 'celebration', startDate: '2026-12-01', endDate: '2026-12-26' },
    { key: 'new_year_2027', titleEn: 'New Year, New Faith', descriptionEn: 'Start the new year with fresh intention and a renewed prayer life.', icon: 'auto_awesome', startDate: '2026-12-27', endDate: '2027-01-07' },
    { key: 'easter_2027', titleEn: 'Easter / Holy Week', descriptionEn: 'Walk through Holy Week toward the hope of the resurrection.', icon: 'church', startDate: '2027-03-21', endDate: '2027-03-28' },
  ];
  for (const item of seasonalEvents) {
    const exists = await prisma.seasonalEvent.findFirst({ where: { key: item.key } });
    if (!exists) await prisma.seasonalEvent.create({ data: item });
  }
  console.log('  ✓ Seasonal events seeded');

  console.log('\n✅  Seed complete!');
  console.log('   Demo login: demo@reviveme.app / password123');
}

seed()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
