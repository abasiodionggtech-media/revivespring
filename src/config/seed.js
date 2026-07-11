require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');

async function seed() {
  console.log('🌱  Seeding ReviveSpring database...');

  // Runs a named seed section in isolation — if one section throws (e.g. a
  // schema mismatch on a recently-added table), it's logged and skipped
  // rather than aborting the entire seed and leaving later sections (like
  // verses, reading plans, memory cards) never inserted.
  const section = async (name, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`  ✗ Seed section "${name}" failed (skipped):`, err.message);
    }
  };
  seed._section = section;

  await section('demo user & sample data', async () => {
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
  });

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
    {
      verseEn: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
      verseKjv: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
      verseNlt: 'For this is how God loved the world: He gave his one and only Son, so that everyone who believes in him will not perish but have eternal life.',
      verseEsv: 'For God so loved the world, that he gave his only Son, that whoever believes in him should not perish but have eternal life.',
      reference: 'John 3:16',
    },
    {
      verseEn: 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.',
      verseKjv: 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.',
      verseNlt: 'And we know that God causes everything to work together for the good of those who love God and are called according to his purpose for them.',
      verseEsv: 'And we know that for those who love God all things work together for good, for those who are called according to his purpose.',
      reference: 'Romans 8:28',
    },
    {
      verseEn: 'So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you.',
      verseKjv: 'Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee.',
      verseNlt: "Don't be afraid, for I am with you. Don't be discouraged, for I am your God. I will strengthen you and help you.",
      verseEsv: 'Fear not, for I am with you; be not dismayed, for I am your God; I will strengthen you, I will help you.',
      reference: 'Isaiah 41:10',
    },
    {
      verseEn: 'God is our refuge and strength, an ever-present help in trouble.',
      verseKjv: 'God is our refuge and strength, a very present help in trouble.',
      verseNlt: 'God is our refuge and strength, always ready to help in times of trouble.',
      verseEsv: 'God is our refuge and strength, a very present help in trouble.',
      reference: 'Psalm 46:1',
    },
    {
      verseEn: '"For I know the plans I have for you," declares the Lord, "plans to prosper you and not to harm you, plans to give you hope and a future."',
      verseKjv: 'For I know the thoughts that I think toward you, saith the Lord, thoughts of peace, and not of evil, to give you an expected end.',
      verseNlt: '"For I know the plans I have for you," says the Lord. "They are plans for good and not for disaster, to give you a future and a hope."',
      verseEsv: 'For I know the plans I have for you, declares the Lord, plans for welfare and not for evil, to give you a future and a hope.',
      reference: 'Jeremiah 29:11',
    },
    {
      verseEn: '"Come to me, all you who are weary and burdened, and I will give you rest."',
      verseKjv: 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.',
      verseNlt: '"Come to me, all of you who are weary and carry heavy burdens, and I will give you rest."',
      verseEsv: 'Come to me, all who labor and are heavy laden, and I will give you rest.',
      reference: 'Matthew 11:28',
    },
    {
      verseEn: 'Your word is a lamp for my feet, a light on my path.',
      verseKjv: 'Thy word is a lamp unto my feet, and a light unto my path.',
      verseNlt: 'Your word is a lamp to guide my feet and a light for my path.',
      verseEsv: 'Your word is a lamp to my feet and a light to my path.',
      reference: 'Psalm 119:105',
    },
    {
      verseEn: 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!',
      verseKjv: 'Therefore if any man be in Christ, he is a new creature: old things are passed away; behold, all things are become new.',
      verseNlt: 'This means that anyone who belongs to Christ has become a new person. The old life is gone; a new life has begun!',
      verseEsv: 'Therefore, if anyone is in Christ, he is a new creation. The old has passed away; behold, the new has come.',
      reference: '2 Corinthians 5:17',
    },
    {
      verseEn: 'Do not conform to the pattern of this world, but be transformed by the renewing of your mind.',
      verseKjv: 'And be not conformed to this world: but be ye transformed by the renewing of your mind.',
      verseNlt: "Don't copy the behavior and customs of this world, but let God transform you into a new person by changing the way you think.",
      verseEsv: 'Do not be conformed to this world, but be transformed by the renewal of your mind.',
      reference: 'Romans 12:2',
    },
    {
      verseEn: 'The Lord is my light and my salvation—whom shall I fear?',
      verseKjv: 'The Lord is my light and my salvation; whom shall I fear?',
      verseNlt: 'The Lord is my light and my salvation, so why should I be afraid?',
      verseEsv: 'The Lord is my light and my salvation; whom shall I fear?',
      reference: 'Psalm 27:1',
    },
    {
      verseEn: 'We love because he first loved us.',
      verseKjv: 'We love him, because he first loved us.',
      verseNlt: 'We love each other because he loved us first.',
      verseEsv: 'We love because he first loved us.',
      reference: '1 John 4:19',
    },
    {
      verseEn: 'The name of the Lord is a fortified tower; the righteous run to it and are safe.',
      verseKjv: 'The name of the Lord is a strong tower: the righteous runneth into it, and is safe.',
      verseNlt: 'The name of the Lord is a strong fortress; the godly run to him and are safe.',
      verseEsv: 'The name of the Lord is a strong tower; the righteous man runs into it and is safe.',
      reference: 'Proverbs 18:10',
    },
    {
      verseEn: 'I lift up my eyes to the mountains—where does my help come from? My help comes from the Lord, the Maker of heaven and earth.',
      verseKjv: 'I will lift up mine eyes unto the hills, from whence cometh my help. My help cometh from the Lord, which made heaven and earth.',
      verseNlt: 'I look up to the mountains—does my help come from there? My help comes from the Lord, who made heaven and earth!',
      verseEsv: 'I lift up my eyes to the hills. From where does my help come? My help comes from the Lord, who made heaven and earth.',
      reference: 'Psalm 121:1-2',
    },
    {
      verseEn: 'Now faith is confidence in what we hope for and assurance about what we do not see.',
      verseKjv: 'Now faith is the substance of things hoped for, the evidence of things not seen.',
      verseNlt: 'Faith shows the reality of what we hope for; it is the evidence of things we cannot see.',
      verseEsv: 'Now faith is the assurance of things hoped for, the conviction of things not seen.',
      reference: 'Hebrews 11:1',
    },
    {
      verseEn: 'If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.',
      verseKjv: 'If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.',
      verseNlt: 'If you need wisdom, ask our generous God, and he will give it to you. He will not rebuke you for asking.',
      verseEsv: 'If any of you lacks wisdom, let him ask God, who gives generously to all without reproach, and it will be given him.',
      reference: 'James 1:5',
    },
    {
      verseEn: 'Cast all your anxiety on him because he cares for you.',
      verseKjv: 'Casting all your care upon him; for he careth for you.',
      verseNlt: 'Give all your worries and cares to God, for he cares about you.',
      verseEsv: 'Casting all your anxieties on him, because he cares for you.',
      reference: '1 Peter 5:7',
    },
    {
      verseEn: 'Weeping may stay for the night, but rejoicing comes in the morning.',
      verseKjv: 'Weeping may endure for a night, but joy cometh in the morning.',
      verseNlt: 'Weeping may last through the night, but joy comes with the morning.',
      verseEsv: 'Weeping may tarry for the night, but joy comes with the morning.',
      reference: 'Psalm 30:5',
    },
    {
      verseEn: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles.',
      verseKjv: 'But they that wait upon the Lord shall renew their strength; they shall mount up with wings as eagles.',
      verseNlt: 'But those who trust in the Lord will find new strength. They will soar high on wings like eagles.',
      verseEsv: 'But they who wait for the Lord shall renew their strength; they shall mount up with wings like eagles.',
      reference: 'Isaiah 40:31',
    },
    {
      verseEn: 'But seek first his kingdom and his righteousness, and all these things will be given to you as well.',
      verseKjv: 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.',
      verseNlt: 'Seek the Kingdom of God above all else, and live righteously, and he will give you everything you need.',
      verseEsv: 'But seek first the kingdom of God and his righteousness, and all these things will be added to you.',
      reference: 'Matthew 6:33',
    },
    {
      verseEn: 'This is the day the Lord has made; let us rejoice and be glad in it.',
      verseKjv: 'This is the day which the Lord hath made; we will rejoice and be glad in it.',
      verseNlt: 'This is the day the Lord has made. We will rejoice and be glad in it.',
      verseEsv: 'This is the day that the Lord has made; let us rejoice and be glad in it.',
      reference: 'Psalm 118:24',
    },
    {
      verseEn: 'In the beginning God created the heavens and the earth.',
      verseKjv: 'In the beginning God created the heaven and the earth.',
      verseNlt: 'In the beginning God created the heavens and the earth.',
      verseEsv: 'In the beginning, God created the heavens and the earth.',
      reference: 'Genesis 1:1',
    },
    {
      verseEn: 'The Lord will fight for you; you need only to be still.',
      verseKjv: 'The Lord shall fight for you, and ye shall hold your peace.',
      verseNlt: 'The Lord himself will fight for you. Just stay calm.',
      verseEsv: 'The Lord will fight for you, and you have only to be silent.',
      reference: 'Exodus 14:14',
    },
    {
      verseEn: 'Be strong and courageous... for the Lord your God goes with you; he will never leave you nor forsake you.',
      verseKjv: 'Be strong and of a good courage... for the Lord thy God, he it is that doth go with thee; he will not fail thee, nor forsake thee.',
      verseNlt: 'Be strong and courageous... For the Lord your God will personally go ahead of you. He will neither fail you nor abandon you.',
      verseEsv: 'Be strong and courageous... it is the Lord your God who goes with you. He will not leave you or forsake you.',
      reference: 'Deuteronomy 31:6',
    },
    {
      verseEn: 'Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty.',
      verseKjv: 'He that dwelleth in the secret place of the most High shall abide under the shadow of the Almighty.',
      verseNlt: 'Those who live in the shelter of the Most High will find rest in the shadow of the Almighty.',
      verseEsv: 'He who dwells in the shelter of the Most High will abide in the shadow of the Almighty.',
      reference: 'Psalm 91:1',
    },
    {
      verseEn: 'Take delight in the Lord, and he will give you the desires of your heart.',
      verseKjv: 'Delight thyself also in the Lord; and he shall give thee the desires of thine heart.',
      verseNlt: 'Take delight in the Lord, and he will give you your heart\u2019s desires.',
      verseEsv: 'Delight yourself in the Lord, and he will give you the desires of your heart.',
      reference: 'Psalm 37:4',
    },
    {
      verseEn: 'When I am afraid, I put my trust in you.',
      verseKjv: 'What time I am afraid, I will trust in thee.',
      verseNlt: 'But when I am afraid, I will put my trust in you.',
      verseEsv: 'When I am afraid, I put my trust in you.',
      reference: 'Psalm 56:3',
    },
    {
      verseEn: 'Truly my soul finds rest in God; my salvation comes from him.',
      verseKjv: 'Truly my soul waiteth upon God: from him cometh my salvation.',
      verseNlt: 'I wait quietly before God, for my victory comes from him.',
      verseEsv: 'For God alone my soul waits in silence; from him comes my salvation.',
      reference: 'Psalm 62:1',
    },
    {
      verseEn: 'Praise the Lord, my soul, and forget not all his benefits—who forgives all your sins and heals all your diseases.',
      verseKjv: 'Bless the Lord, O my soul, and forget not all his benefits: who forgiveth all thine iniquities; who healeth all thy diseases.',
      verseNlt: 'Let all that I am praise the Lord; may I never forget the good things he does for me. He forgives all my sins and heals all my diseases.',
      verseEsv: 'Bless the Lord, O my soul, and forget not all his benefits, who forgives all your iniquity, who heals all your diseases.',
      reference: 'Psalm 103:2-3',
    },
    {
      verseEn: 'I praise you because I am fearfully and wonderfully made; your works are wonderful, I know that full well.',
      verseKjv: 'I will praise thee; for I am fearfully and wonderfully made: marvellous are thy works; and that my soul knoweth right well.',
      verseNlt: 'Thank you for making me so wonderfully complex! Your workmanship is marvelous.',
      verseEsv: 'I praise you, for I am fearfully and wonderfully made. Wonderful are your works; my soul knows it very well.',
      reference: 'Psalm 139:14',
    },
    {
      verseEn: 'The Lord is near to all who call on him, to all who call on him in truth.',
      verseKjv: 'The Lord is nigh unto all them that call upon him, to all that call upon him in truth.',
      verseNlt: 'The Lord is close to all who call on him, yes, to all who call on him in truth.',
      verseEsv: 'The Lord is near to all who call on him, to all who call on him in truth.',
      reference: 'Psalm 145:18',
    },
    {
      verseEn: 'Commit to the Lord whatever you do, and he will establish your plans.',
      verseKjv: 'Commit thy works unto the Lord, and thy thoughts shall be established.',
      verseNlt: 'Commit your actions to the Lord, and your plans will succeed.',
      verseEsv: 'Commit your work to the Lord, and your plans will be established.',
      reference: 'Proverbs 16:3',
    },
    {
      verseEn: 'In their hearts humans plan their course, but the Lord establishes their steps.',
      verseKjv: 'A man\u2019s heart deviseth his way: but the Lord directeth his steps.',
      verseNlt: 'We can make our own plans, but the Lord determines our steps.',
      verseEsv: 'The heart of man plans his way, but the Lord establishes his steps.',
      reference: 'Proverbs 16:9',
    },
    {
      verseEn: 'Start children off on the way they should go, and even when they are old they will not turn from it.',
      verseKjv: 'Train up a child in the way he should go: and when he is old, he will not depart from it.',
      verseNlt: 'Direct your children onto the right path, and when they are older, they will not leave it.',
      verseEsv: 'Train up a child in the way he should go; even when he is old he will not depart from it.',
      reference: 'Proverbs 22:6',
    },
    {
      verseEn: 'There is a time for everything, and a season for every activity under the heavens.',
      verseKjv: 'To every thing there is a season, and a time to every purpose under the heaven.',
      verseNlt: 'For everything there is a season, a time for every activity under heaven.',
      verseEsv: 'For everything there is a season, and a time for every matter under heaven.',
      reference: 'Ecclesiastes 3:1',
    },
    {
      verseEn: 'You will keep in perfect peace those whose minds are steadfast, because they trust in you.',
      verseKjv: 'Thou wilt keep him in perfect peace, whose mind is stayed on thee: because he trusteth in thee.',
      verseNlt: 'You will keep in perfect peace all who trust in you, all whose thoughts are fixed on you!',
      verseEsv: 'You keep him in perfect peace whose mind is stayed on you, because he trusts in you.',
      reference: 'Isaiah 26:3',
    },
    {
      verseEn: 'When you pass through the waters, I will be with you; and when you pass through the rivers, they will not sweep over you.',
      verseKjv: 'When thou passest through the waters, I will be with thee; and through the rivers, they shall not overflow thee.',
      verseNlt: 'When you go through deep waters, I will be with you. When you go through rivers of difficulty, you will not drown.',
      verseEsv: 'When you pass through the waters, I will be with you; and through the rivers, they shall not overwhelm you.',
      reference: 'Isaiah 43:2',
    },
    {
      verseEn: 'But he was pierced for our transgressions, he was crushed for our iniquities; the punishment that brought us peace was on him, and by his wounds we are healed.',
      verseKjv: 'But he was wounded for our transgressions, he was bruised for our iniquities: the chastisement of our peace was upon him; and with his stripes we are healed.',
      verseNlt: 'But he was pierced for our rebellion, crushed for our sins. He was beaten so we could be whole. He was whipped so we could be healed.',
      verseEsv: 'But he was pierced for our transgressions; he was crushed for our iniquities; upon him was the chastisement that brought us peace, and with his wounds we are healed.',
      reference: 'Isaiah 53:5',
    },
    {
      verseEn: 'For my thoughts are not your thoughts, neither are your ways my ways, declares the Lord.',
      verseKjv: 'For my thoughts are not your thoughts, neither are your ways my ways, saith the Lord.',
      verseNlt: '"My thoughts are nothing like your thoughts," says the Lord. "And my ways are far beyond anything you could imagine."',
      verseEsv: 'For my thoughts are not your thoughts, neither are your ways my ways, declares the Lord.',
      reference: 'Isaiah 55:8',
    },
    {
      verseEn: 'But blessed is the one who trusts in the Lord, whose confidence is in him.',
      verseKjv: 'For blessed is the man that trusteth in the Lord, and whose hope the Lord is.',
      verseNlt: 'But blessed are those who trust in the Lord and have made the Lord their hope and confidence.',
      verseEsv: 'Blessed is the man who trusts in the Lord, whose trust is the Lord.',
      reference: 'Jeremiah 17:7',
    },
    {
      verseEn: 'Call to me and I will answer you and tell you great and unsearchable things you do not know.',
      verseKjv: 'Call unto me, and I will answer thee, and shew thee great and mighty things, which thou knowest not.',
      verseNlt: 'Ask me and I will tell you remarkable secrets you do not know about things to come.',
      verseEsv: 'Call to me and I will answer you, and will tell you great and hidden things that you have not known.',
      reference: 'Jeremiah 33:3',
    },
    {
      verseEn: 'You are the light of the world. A town built on a hill cannot be hidden.',
      verseKjv: 'Ye are the light of the world. A city that is set on an hill cannot be hid.',
      verseNlt: 'You are the light of the world—like a city on a hilltop that cannot be hidden.',
      verseEsv: 'You are the light of the world. A city set on a hill cannot be hidden.',
      reference: 'Matthew 5:14',
    },
    {
      verseEn: 'Therefore do not worry about tomorrow, for tomorrow will worry about itself. Each day has enough trouble of its own.',
      verseKjv: 'Take therefore no thought for the morrow: for the morrow shall take thought for the things of itself. Sufficient unto the day is the evil thereof.',
      verseNlt: 'So don\u2019t worry about tomorrow, for tomorrow will bring its own worries. Today\u2019s trouble is enough for today.',
      verseEsv: 'Therefore do not be anxious about tomorrow, for tomorrow will be anxious for itself. Sufficient for the day is its own trouble.',
      reference: 'Matthew 6:34',
    },
    {
      verseEn: 'Ask and it will be given to you; seek and you will find; knock and the door will be opened to you.',
      verseKjv: 'Ask, and it shall be given you; seek, and ye shall find; knock, and it shall be opened unto you.',
      verseNlt: 'Keep on asking, and you will receive what you ask for. Keep on seeking, and you will find. Keep on knocking, and the door will be opened.',
      verseEsv: 'Ask, and it will be given to you; seek, and you will find; knock, and it will be opened to you.',
      reference: 'Matthew 7:7',
    },
    {
      verseEn: 'And surely I am with you always, to the very end of the age.',
      verseKjv: 'And, lo, I am with you alway, even unto the end of the world.',
      verseNlt: 'And be sure of this: I am with you always, even to the end of the age.',
      verseEsv: 'And behold, I am with you always, to the end of the age.',
      reference: 'Matthew 28:20',
    },
    {
      verseEn: 'Therefore I tell you, whatever you ask for in prayer, believe that you have received it, and it will be yours.',
      verseKjv: 'Therefore I say unto you, What things soever ye desire, when ye pray, believe that ye receive them, and ye shall have them.',
      verseNlt: 'I tell you, you can pray for anything, and if you believe that you\u2019ve received it, it will be yours.',
      verseEsv: 'Therefore I tell you, whatever you ask in prayer, believe that you have received it, and it will be yours.',
      reference: 'Mark 11:24',
    },
    {
      verseEn: 'For no word from God will ever fail.',
      verseKjv: 'For with God nothing shall be impossible.',
      verseNlt: 'For the word of God will never fail.',
      verseEsv: 'For nothing will be impossible with God.',
      reference: 'Luke 1:37',
    },
    {
      verseEn: 'In the beginning was the Word, and the Word was with God, and the Word was God.',
      verseKjv: 'In the beginning was the Word, and the Word was with God, and the Word was God.',
      verseNlt: 'In the beginning the Word already existed. The Word was with God, and the Word was God.',
      verseEsv: 'In the beginning was the Word, and the Word was with God, and the Word was God.',
      reference: 'John 1:1',
    },
    {
      verseEn: 'Then you will know the truth, and the truth will set you free.',
      verseKjv: 'And ye shall know the truth, and the truth shall make you free.',
      verseNlt: 'And you will know the truth, and the truth will set you free.',
      verseEsv: 'And you will know the truth, and the truth will set you free.',
      reference: 'John 8:32',
    },
    {
      verseEn: 'The thief comes only to steal and kill and destroy; I have come that they may have life, and have it to the full.',
      verseKjv: 'The thief cometh not, but for to steal, and to kill, and to destroy: I am come that they might have life, and that they might have it more abundantly.',
      verseNlt: 'The thief\u2019s purpose is to steal and kill and destroy. My purpose is to give them a rich and satisfying life.',
      verseEsv: 'The thief comes only to steal and kill and destroy. I came that they may have life and have it abundantly.',
      reference: 'John 10:10',
    },
    {
      verseEn: 'A new command I give you: Love one another. As I have loved you, so you must love one another.',
      verseKjv: 'A new commandment I give unto you, That ye love one another; as I have loved you, that ye also love one another.',
      verseNlt: 'So now I am giving you a new commandment: Love each other. Just as I have loved you, you should love each other.',
      verseEsv: 'A new commandment I give to you, that you love one another: just as I have loved you, you also are to love one another.',
      reference: 'John 13:34',
    },
    {
      verseEn: 'I am the way and the truth and the life. No one comes to the Father except through me.',
      verseKjv: 'I am the way, the truth, and the life: no man cometh unto the Father, but by me.',
      verseNlt: 'I am the way, the truth, and the life. No one can come to the Father except through me.',
      verseEsv: 'I am the way, and the truth, and the life. No one comes to the Father except through me.',
      reference: 'John 14:6',
    },
    {
      verseEn: 'Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.',
      verseKjv: 'Peace I leave with you, my peace I give unto you: not as the world giveth, give I unto you. Let not your heart be troubled, neither let it be afraid.',
      verseNlt: 'I am leaving you with a gift—peace of mind and heart. And the peace I give is a gift the world cannot give. So don\u2019t be troubled or afraid.',
      verseEsv: 'Peace I leave with you; my peace I give to you... Let not your hearts be troubled, neither let them be afraid.',
      reference: 'John 14:27',
    },
    {
      verseEn: 'I am the vine; you are the branches. If you remain in me and I in you, you will bear much fruit; apart from me you can do nothing.',
      verseKjv: 'I am the vine, ye are the branches: He that abideth in me, and I in him, the same bringeth forth much fruit: for without me ye can do nothing.',
      verseNlt: 'Yes, I am the vine; you are the branches. Those who remain in me, and I in them, will produce much fruit. For apart from me you can do nothing.',
      verseEsv: 'I am the vine; you are the branches. Whoever abides in me and I in him, he it is that bears much fruit, for apart from me you can do nothing.',
      reference: 'John 15:5',
    },
    {
      verseEn: 'I have told you these things, so that in me you may have peace. In this world you will have trouble. But take heart! I have overcome the world.',
      verseKjv: 'These things I have spoken unto you, that in me ye might have peace. In the world ye shall have tribulation: but be of good cheer; I have overcome the world.',
      verseNlt: 'I have told you all this so that you may have peace in me. Here on earth you will have many trials and sorrows. But take heart, because I have overcome the world.',
      verseEsv: 'I have said these things to you, that in me you may have peace. In the world you will have tribulation. But take heart; I have overcome the world.',
      reference: 'John 16:33',
    },
    {
      verseEn: 'But you will receive power when the Holy Spirit comes on you; and you will be my witnesses.',
      verseKjv: 'But ye shall receive power, after that the Holy Ghost is come upon you: and ye shall be witnesses unto me.',
      verseNlt: 'But you will receive power when the Holy Spirit comes upon you. And you will be my witnesses.',
      verseEsv: 'But you will receive power when the Holy Spirit has come upon you, and you will be my witnesses.',
      reference: 'Acts 1:8',
    },
    {
      verseEn: 'But God demonstrates his own love for us in this: While we were still sinners, Christ died for us.',
      verseKjv: 'But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.',
      verseNlt: 'But God showed his great love for us by sending Christ to die for us while we were still sinners.',
      verseEsv: 'But God shows his love for us in that while we were still sinners, Christ died for us.',
      reference: 'Romans 5:8',
    },
    {
      verseEn: 'No temptation has overtaken you except what is common to mankind. And God is faithful; he will not let you be tempted beyond what you can bear.',
      verseKjv: 'There hath no temptation taken you but such as is common to man: but God is faithful, who will not suffer you to be tempted above that ye are able.',
      verseNlt: 'The temptations in your life are no different from what others experience. And God is faithful. He will not allow the temptation to be more than you can stand.',
      verseEsv: 'No temptation has overtaken you that is not common to man. God is faithful, and he will not let you be tempted beyond your ability.',
      reference: '1 Corinthians 10:13',
    },
    {
      verseEn: 'Love is patient, love is kind. It does not envy, it does not boast, it is not proud.',
      verseKjv: 'Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up.',
      verseNlt: 'Love is patient and kind. Love is not jealous or boastful or proud.',
      verseEsv: 'Love is patient and kind; love does not envy or boast; it is not arrogant.',
      reference: '1 Corinthians 13:4',
    },
    {
      verseEn: 'And now these three remain: faith, hope and love. But the greatest of these is love.',
      verseKjv: 'And now abideth faith, hope, charity, these three; but the greatest of these is charity.',
      verseNlt: 'Three things will last forever—faith, hope, and love—and the greatest of these is love.',
      verseEsv: 'So now faith, hope, and love abide, these three; but the greatest of these is love.',
      reference: '1 Corinthians 13:13',
    },
    {
      verseEn: 'Therefore we do not lose heart. Though outwardly we are wasting away, yet inwardly we are being renewed day by day.',
      verseKjv: 'For which cause we faint not; but though our outward man perish, yet the inward man is renewed day by day.',
      verseNlt: 'That is why we never give up. Though our bodies are dying, our inner strength in the Lord is renewed every day.',
      verseEsv: 'So we do not lose heart. Though our outer self is wasting away, our inner self is being renewed day by day.',
      reference: '2 Corinthians 4:16',
    },
    {
      verseEn: 'But he said to me, "My grace is sufficient for you, for my power is made perfect in weakness."',
      verseKjv: 'And he said unto me, My grace is sufficient for thee: for my strength is made perfect in weakness.',
      verseNlt: 'Each time he said, "My grace is all you need. My power works best in weakness."',
      verseEsv: 'But he said to me, "My grace is sufficient for you, for my power is made perfect in weakness."',
      reference: '2 Corinthians 12:9',
    },
    {
      verseEn: 'But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness, gentleness and self-control.',
      verseKjv: 'But the fruit of the Spirit is love, joy, peace, longsuffering, gentleness, goodness, faith, meekness, temperance.',
      verseNlt: 'But the Holy Spirit produces this kind of fruit in our lives: love, joy, peace, patience, kindness, goodness, faithfulness, gentleness, and self-control.',
      verseEsv: 'But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faithfulness, gentleness, self-control.',
      reference: 'Galatians 5:22-23',
    },
    {
      verseEn: 'Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.',
      verseKjv: 'And let us not be weary in well doing: for in due season we shall reap, if we faint not.',
      verseNlt: 'So let\u2019s not get tired of doing what is good. At just the right time we will reap a harvest of blessing if we don\u2019t give up.',
      verseEsv: 'And let us not grow weary of doing good, for in due season we will reap, if we do not give up.',
      reference: 'Galatians 6:9',
    },
    {
      verseEn: 'For it is by grace you have been saved, through faith—and this is not from yourselves, it is the gift of God—not by works, so that no one can boast.',
      verseKjv: 'For by grace are ye saved through faith; and that not of yourselves: it is the gift of God: Not of works, lest any man should boast.',
      verseNlt: 'God saved you by his grace when you believed. And you can\u2019t take credit for this; it is a gift from God. Salvation is not a reward for the good things we have done, so none of us can boast about it.',
      verseEsv: 'For by grace you have been saved through faith. And this is not your own doing; it is the gift of God, not a result of works, so that no one may boast.',
      reference: 'Ephesians 2:8-9',
    },
    {
      verseEn: "Because of the Lord's great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.",
      verseKjv: "It is of the Lord's mercies that we are not consumed, because his compassions fail not. They are new every morning: great is thy faithfulness.",
      verseNlt: 'The faithful love of the Lord never ends! His mercies never cease. Great is his faithfulness; his mercies begin afresh each morning.',
      verseEsv: "The steadfast love of the Lord never ceases; his mercies never come to an end; they are new every morning; great is your faithfulness.",
      reference: 'Lamentations 3:22-23',
    },
    {
      verseEn: 'He has shown you, O mortal, what is good. And what does the Lord require of you? To act justly and to love mercy and to walk humbly with your God.',
      verseKjv: 'He hath shewed thee, O man, what is good; and what doth the Lord require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?',
      verseNlt: 'No, O people, the Lord has told you what is good, and this is what he requires of you: to do what is right, to love mercy, and to walk humbly with your God.',
      verseEsv: 'He has told you, O man, what is good; and what does the Lord require of you but to do justice, and to love kindness, and to walk humbly with your God?',
      reference: 'Micah 6:8',
    },
    {
      verseEn: 'The Lord your God is with you, the Mighty Warrior who saves. He will take great delight in you; in his love he will no longer rebuke you, but will rejoice over you with singing.',
      verseKjv: 'The Lord thy God in the midst of thee is mighty; he will save, he will rejoice over thee with joy; he will rest in his love, he will joy over thee with singing.',
      verseNlt: 'For the Lord your God is living among you. He is a mighty savior. He will take delight in you with gladness. With his love, he will calm all your fears. He will rejoice over you with joyful songs.',
      verseEsv: 'The Lord your God is in your midst, a mighty one who will save; he will rejoice over you with gladness; he will quiet you by his love; he will exult over you with loud singing.',
      reference: 'Zephaniah 3:17',
    },
    {
      verseEn: 'If you declare with your mouth, "Jesus is Lord," and believe in your heart that God raised him from the dead, you will be saved.',
      verseKjv: 'That if thou shalt confess with thy mouth the Lord Jesus, and shalt believe in thine heart that God hath raised him from the dead, thou shalt be saved.',
      verseNlt: 'If you openly declare that Jesus is Lord and believe in your heart that God raised him from the dead, you will be saved.',
      verseEsv: 'Because, if you confess with your mouth that Jesus is Lord and believe in your heart that God raised him from the dead, you will be saved.',
      reference: 'Romans 10:9',
    },
    {
      verseEn: 'May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope by the power of the Holy Spirit.',
      verseKjv: 'Now the God of hope fill you with all joy and peace in believing, that ye may abound in hope, through the power of the Holy Ghost.',
      verseNlt: 'I pray that God, the source of hope, will fill you completely with joy and peace because you trust in him. Then you will overflow with confident hope through the power of the Holy Spirit.',
      verseEsv: 'May the God of hope fill you with all joy and peace in believing, so that by the power of the Holy Spirit you may abound in hope.',
      reference: 'Romans 15:13',
    },
    {
      verseEn: 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.',
      verseKjv: 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God. And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.',
      verseNlt: "Don't worry about anything; instead, pray about everything. Tell God what you need, and thank him for all he has done. Then you will experience God's peace, which exceeds anything we can understand. His peace will guard your hearts and minds as you live in Christ Jesus.",
      verseEsv: 'Do not be anxious about anything, but in everything by prayer and supplication with thanksgiving let your requests be made known to God. And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.',
      reference: 'Philippians 4:6-7',
    },
    {
      verseEn: 'Finally, brothers and sisters, whatever is true, whatever is noble, whatever is right, whatever is pure, whatever is lovely, whatever is admirable—if anything is excellent or praiseworthy—think about such things.',
      verseKjv: 'Finally, brethren, whatsoever things are true, whatsoever things are honest, whatsoever things are just, whatsoever things are pure, whatsoever things are lovely, whatsoever things are of good report; if there be any virtue, and if there be any praise, think on these things.',
      verseNlt: "Fix your thoughts on what is true, and honorable, and right, and pure, and lovely, and admirable. Think about things that are excellent and worthy of praise.",
      verseEsv: 'Finally, brothers, whatever is true, whatever is honorable, whatever is just, whatever is pure, whatever is lovely, whatever is commendable, if there is any excellence, if there is anything worthy of praise, think about these things.',
      reference: 'Philippians 4:8',
    },
    {
      verseEn: 'Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.',
      verseKjv: 'And whatsoever ye do, do it heartily, as to the Lord, and not unto men.',
      verseNlt: 'Work willingly at whatever you do, as though you were working for the Lord rather than for people.',
      verseEsv: 'Whatever you do, work heartily, as for the Lord and not for men.',
      reference: 'Colossians 3:23',
    },
    {
      verseEn: 'Finally, be strong in the Lord and in his mighty power.',
      verseKjv: 'Finally, my brethren, be strong in the Lord, and in the power of his might.',
      verseNlt: 'A final word: Be strong in the Lord and in his mighty power.',
      verseEsv: 'Finally, be strong in the Lord and in the strength of his might.',
      reference: 'Ephesians 6:10',
    },
    {
      verseEn: '...God has said, "Never will I leave you; never will I forsake you."',
      verseKjv: '...for he hath said, I will never leave thee, nor forsake thee.',
      verseNlt: '...God has said, "I will never fail you. I will never abandon you."',
      verseEsv: '...for he has said, "I will never leave you nor forsake you."',
      reference: 'Hebrews 13:5',
    },
    {
      verseEn: 'Submit yourselves, then, to God. Resist the devil, and he will flee from you.',
      verseKjv: 'Submit yourselves therefore to God. Resist the devil, and he will flee from you.',
      verseNlt: 'So humble yourselves before God. Resist the devil, and he will flee from you.',
      verseEsv: 'Submit yourselves therefore to God. Resist the devil, and he will flee from you.',
      reference: 'James 4:7',
    },
    {
      verseEn: 'If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.',
      verseKjv: 'If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness.',
      verseNlt: 'But if we confess our sins to him, he is faithful and just to forgive us our sins and to cleanse us from all wickedness.',
      verseEsv: 'If we confess our sins, he is faithful and just to forgive us our sins and to cleanse us from all unrighteousness.',
      reference: '1 John 1:9',
    },
  ];
  await section('daily verses', async () => {
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
  });

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
    { titleEn: '7 Days of Forgiveness', descriptionEn: 'A short challenge to pray through releasing bitterness and choosing forgiveness.', durationDays: 7, category: 'forgiveness', sortOrder: 3 },
    { titleEn: '14 Days for Your Family', descriptionEn: 'Two weeks of focused daily prayer over your family and household.', durationDays: 14, category: 'family', sortOrder: 4 },
    { titleEn: '10 Days of Breakthrough', descriptionEn: 'Ten days of bold, persistent prayer for a specific breakthrough you are believing for.', durationDays: 10, category: 'breakthrough', sortOrder: 5 },
    { titleEn: '5 Days of Rest', descriptionEn: 'A short reset for the weary — five days of prayer centered on rest and God\'s peace.', durationDays: 5, category: 'rest', sortOrder: 6 },
  ];
  await section('prayer challenges', async () => {
    for (const item of challenges) {
      const exists = await prisma.challenge.findFirst({ where: { titleEn: item.titleEn } });
      if (!exists) await prisma.challenge.create({ data: item });
    }
    console.log('  ✓ Prayer challenges seeded');
  });

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
    {
      titleEn: 'Proverbs for Daily Wisdom',
      descriptionEn: 'Seven days of practical wisdom for everyday decisions and relationships.',
      durationDays: 7,
      days: [
        { day: 1, referenceEn: 'Proverbs 1:1-9', titleEn: 'The beginning of wisdom' },
        { day: 2, referenceEn: 'Proverbs 3:1-12', titleEn: 'Trust in the Lord' },
        { day: 3, referenceEn: 'Proverbs 4:20-27', titleEn: 'Guard your heart' },
        { day: 4, referenceEn: 'Proverbs 10:1-12', titleEn: 'Wise and foolish living' },
        { day: 5, referenceEn: 'Proverbs 16:1-9', titleEn: 'The Lord directs our steps' },
        { day: 6, referenceEn: 'Proverbs 17:17, 27:17', titleEn: 'Wisdom in friendship' },
        { day: 7, referenceEn: 'Proverbs 31:10-31', titleEn: 'A life well lived' },
      ],
      sortOrder: 2,
    },
    {
      titleEn: 'Fruit of the Spirit',
      descriptionEn: 'A nine-day walk through Galatians 5, one fruit of the Spirit at a time.',
      durationDays: 9,
      days: [
        { day: 1, referenceEn: 'Galatians 5:16-26', titleEn: 'Walking by the Spirit' },
        { day: 2, referenceEn: 'John 15:9-13', titleEn: 'Love' },
        { day: 3, referenceEn: 'Philippians 4:4-7', titleEn: 'Joy' },
        { day: 4, referenceEn: 'John 14:25-27', titleEn: 'Peace' },
        { day: 5, referenceEn: 'James 1:2-4', titleEn: 'Patience' },
        { day: 6, referenceEn: 'Ephesians 4:29-32', titleEn: 'Kindness' },
        { day: 7, referenceEn: 'Micah 6:6-8', titleEn: 'Goodness' },
        { day: 8, referenceEn: 'Lamentations 3:22-23', titleEn: 'Faithfulness' },
        { day: 9, referenceEn: '1 Corinthians 9:24-27', titleEn: 'Self-control' },
      ],
      sortOrder: 3,
    },
  ];
  await section('reading plans', async () => {
    for (const item of readingPlans) {
      const exists = await prisma.readingPlan.findFirst({ where: { titleEn: item.titleEn } });
      if (!exists) await prisma.readingPlan.create({ data: item });
    }
    console.log('  ✓ Bible reading plans seeded');
  });

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
    { referenceEn: 'Philippians 4:13', verseEn: 'I can do all this through him who gives me strength.', category: 'strength', sortOrder: 7 },
    { referenceEn: 'Psalm 23:1', verseEn: 'The Lord is my shepherd, I lack nothing.', category: 'trust', sortOrder: 8 },
    { referenceEn: 'Joshua 1:9', verseEn: 'Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.', category: 'courage', sortOrder: 9 },
    { referenceEn: 'Matthew 11:28', verseEn: 'Come to me, all you who are weary and burdened, and I will give you rest.', category: 'comfort', sortOrder: 10 },
    { referenceEn: 'Psalm 34:8', verseEn: 'Taste and see that the Lord is good; blessed is the one who takes refuge in him.', category: 'gratitude', sortOrder: 11 },
    { referenceEn: 'Proverbs 18:10', verseEn: 'The name of the Lord is a fortified tower; the righteous run to it and are safe.', category: 'protection', sortOrder: 12 },
    { referenceEn: 'Isaiah 40:31', verseEn: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles.', category: 'hope', sortOrder: 13 },
    { referenceEn: 'Psalm 27:1', verseEn: 'The Lord is my light and my salvation—whom shall I fear?', category: 'courage', sortOrder: 14 },
    { referenceEn: '1 John 4:19', verseEn: 'We love because he first loved us.', category: 'love', sortOrder: 15 },
    { referenceEn: 'Romans 12:2', verseEn: 'Do not conform to the pattern of this world, but be transformed by the renewing of your mind.', category: 'purpose', sortOrder: 16 },
    { referenceEn: '2 Corinthians 5:17', verseEn: 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!', category: 'salvation', sortOrder: 17 },
    { referenceEn: 'Hebrews 11:1', verseEn: 'Now faith is confidence in what we hope for and assurance about what we do not see.', category: 'faith', sortOrder: 18 },
    { referenceEn: 'James 1:5', verseEn: 'If any of you lacks wisdom, you should ask God, who gives generously to all without finding fault, and it will be given to you.', category: 'wisdom', sortOrder: 19 },
    { referenceEn: '1 Peter 5:7', verseEn: 'Cast all your anxiety on him because he cares for you.', category: 'peace', sortOrder: 20 },
    { referenceEn: 'Psalm 119:105', verseEn: 'Your word is a lamp for my feet, a light on my path.', category: 'guidance', sortOrder: 21 },
    { referenceEn: 'Matthew 6:33', verseEn: 'But seek first his kingdom and his righteousness, and all these things will be given to you as well.', category: 'purpose', sortOrder: 22 },
    { referenceEn: 'Psalm 121:2', verseEn: 'My help comes from the Lord, the Maker of heaven and earth.', category: 'trust', sortOrder: 23 },
    { referenceEn: 'Galatians 2:20', verseEn: 'I have been crucified with Christ and I no longer live, but Christ lives in me.', category: 'faith', sortOrder: 24 },
    { referenceEn: 'Ephesians 2:8-9', verseEn: 'For it is by grace you have been saved, through faith—and this is not from yourselves, it is the gift of God—not by works, so that no one can boast.', category: 'grace', sortOrder: 25 },
    { referenceEn: 'Nahum 1:7', verseEn: 'The Lord is good, a refuge in times of trouble. He cares for those who trust in him.', category: 'comfort', sortOrder: 26 },
    { referenceEn: 'Zephaniah 3:17', verseEn: 'The Lord your God is with you, the Mighty Warrior who saves. He will take great delight in you; he will rejoice over you with singing.', category: 'love', sortOrder: 27 },
    { referenceEn: 'Psalm 37:4', verseEn: 'Take delight in the Lord, and he will give you the desires of your heart.', category: 'joy', sortOrder: 28 },
    { referenceEn: 'Proverbs 16:3', verseEn: 'Commit to the Lord whatever you do, and he will establish your plans.', category: 'guidance', sortOrder: 29 },
    { referenceEn: 'Isaiah 26:3', verseEn: 'You will keep in perfect peace those whose minds are steadfast, because they trust in you.', category: 'peace', sortOrder: 30 },
    { referenceEn: 'John 14:27', verseEn: 'Peace I leave with you; my peace I give you. Do not let your hearts be troubled and do not be afraid.', category: 'peace', sortOrder: 31 },
    { referenceEn: 'Romans 15:13', verseEn: 'May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope by the power of the Holy Spirit.', category: 'hope', sortOrder: 32 },
    { referenceEn: 'Psalm 55:22', verseEn: 'Cast your cares on the Lord and he will sustain you; he will never let the righteous be shaken.', category: 'peace', sortOrder: 33 },
    { referenceEn: 'Micah 6:8', verseEn: 'He has shown you, O mortal, what is good. And what does the Lord require of you? To act justly and to love mercy and to walk humbly with your God.', category: 'wisdom', sortOrder: 34 },
    { referenceEn: 'Colossians 3:23', verseEn: 'Whatever you do, work at it with all your heart, as working for the Lord, not for human masters.', category: 'purpose', sortOrder: 35 },
    { referenceEn: '1 Corinthians 13:4', verseEn: 'Love is patient, love is kind. It does not envy, it does not boast, it is not proud.', category: 'love', sortOrder: 36 },
    { referenceEn: 'Psalm 139:14', verseEn: 'I praise you because I am fearfully and wonderfully made; your works are wonderful, I know that full well.', category: 'gratitude', sortOrder: 37 },
    { referenceEn: 'Lamentations 3:22-23', verseEn: "Because of the Lord's great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.", category: 'faith', sortOrder: 38 },
    { referenceEn: 'Romans 10:9', verseEn: 'If you declare with your mouth, "Jesus is Lord," and believe in your heart that God raised him from the dead, you will be saved.', category: 'salvation', sortOrder: 39 },
    { referenceEn: 'Ephesians 6:10', verseEn: 'Finally, be strong in the Lord and in his mighty power.', category: 'strength', sortOrder: 40 },
    { referenceEn: 'Psalm 90:12', verseEn: 'Teach us to number our days, that we may gain a heart of wisdom.', category: 'wisdom', sortOrder: 41 },
    { referenceEn: 'Revelation 21:4', verseEn: 'He will wipe every tear from their eyes. There will be no more death or mourning or crying or pain, for the old order of things has passed away.', category: 'comfort', sortOrder: 42 },
  ];
  await section('memory cards', async () => {
    for (const item of memoryCards) {
      const exists = await prisma.memoryCard.findFirst({ where: { referenceEn: item.referenceEn } });
      if (!exists) await prisma.memoryCard.create({ data: item });
    }
    console.log('  ✓ Scripture memory cards seeded');
  });

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

module.exports = seed;

// Only auto-run-and-exit when this file is executed directly
// (`node src/config/seed.js` or `npm run seed`) — when it's `require()`d
// from elsewhere (e.g. the server auto-seeding itself on boot), the caller
// controls the Prisma connection lifecycle instead.
if (require.main === module) {
  seed()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
