'use strict';
const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();
const today = () => new Date().toISOString().split('T')[0];

// A short rotating verse/blessing "gift" — day-of-year indexed so everyone sees a fresh one daily.
const MANNA = {
  en: [
    { verse: 'The steadfast love of the Lord never ceases; his mercies never come to an end; they are new every morning.', ref: 'Lamentations 3:22-23', blessing: 'Today, receive a fresh portion of grace — enough for exactly what you need.' },
    { verse: 'Give us this day our daily bread.', ref: 'Matthew 6:11', blessing: 'God is not withholding provision from you today. Ask, and receive.' },
    { verse: 'Man shall not live by bread alone, but by every word that comes from the mouth of God.', ref: 'Matthew 4:4', blessing: 'Let today\'s portion nourish more than your body — let it feed your spirit.' },
    { verse: 'My God will supply every need of yours according to his riches in glory.', ref: 'Philippians 4:19', blessing: 'Whatever you are lacking today, He already sees it and provides.' },
    { verse: 'The Lord is my shepherd; I shall not want.', ref: 'Psalm 23:1', blessing: 'You are cared for today. Rest in that.' },
    { verse: 'His compassions fail not. They are new every morning; great is your faithfulness.', ref: 'Lamentations 3:22-23', blessing: 'Whatever yesterday held, today is a clean gift.' },
    { verse: 'I have learned in whatsoever state I am, therewith to be content.', ref: 'Philippians 4:11', blessing: 'Contentment is a gift for today — receive it.' },
  ],
  fr: [
    { verse: "C'est un effet des misericordes de l'Eternel que nous ne soyons pas consumes, car ses compassions ne sont pas epuisees; elles se renouvellent chaque matin.", ref: 'Lamentations 3:22-23', blessing: "Recevez aujourd'hui une portion fraiche de grace." },
    { verse: 'Donne-nous aujourd\'hui notre pain quotidien.', ref: 'Matthieu 6:11', blessing: "Dieu ne vous prive pas de Sa provision aujourd'hui." },
    { verse: "L'homme ne vivra pas de pain seulement, mais de toute parole qui sort de la bouche de Dieu.", ref: 'Matthieu 4:4', blessing: "Que la portion d'aujourd'hui nourrisse aussi votre esprit." },
    { verse: 'Et mon Dieu pourvoira a tous vos besoins selon sa richesse, avec gloire.', ref: 'Philippiens 4:19', blessing: 'Ce qui vous manque aujourd\'hui, Il le voit deja.' },
    { verse: "L'Eternel est mon berger: je ne manquerai de rien.", ref: 'Psaume 23:1', blessing: "On prend soin de vous aujourd'hui." },
    { verse: 'Ses compassions se renouvellent chaque matin. Oh! la grande fidelite!', ref: 'Lamentations 3:22-23', blessing: "Quoi qu'ait ete hier, aujourd'hui est un don nouveau." },
    { verse: "J'ai appris a etre content de l'etat ou je me trouve.", ref: 'Philippiens 4:11', blessing: "Le contentement est un don pour aujourd'hui." },
  ],
};

function mannaForToday(language) {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const arr = MANNA[language] || MANNA.en;
  return arr[dayOfYear % arr.length];
}

function mannaState(onboardingData) {
  const state = (onboardingData && onboardingData.dailyManna) || {};
  return {
    lastClaimedDate: state.lastClaimedDate || null,
    streak: state.streak || 0,
    totalClaimed: state.totalClaimed || 0,
  };
}

// GET /api/daily-manna/status
router.get('/status', async (req, res, next) => {
  try {
    const state = mannaState(req.user.onboardingData);
    res.json({
      available: state.lastClaimedDate !== today(),
      streak: state.streak,
      totalClaimed: state.totalClaimed,
      preview: mannaForToday(req.user.language),
    });
  } catch (err) { next(err); }
});

// POST /api/daily-manna/claim
router.post('/claim', async (req, res, next) => {
  try {
    const date = today();
    const state = mannaState(req.user.onboardingData);
    if (state.lastClaimedDate === date) {
      return res.status(409).json({ message: 'Today\'s manna has already been claimed.', available: false, streak: state.streak, totalClaimed: state.totalClaimed });
    }
    const previous = state.lastClaimedDate ? new Date(`${state.lastClaimedDate}T00:00:00Z`) : null;
    const current = new Date(`${date}T00:00:00Z`);
    const diff = previous ? Math.round((current - previous) / 86400000) : null;
    const streak = diff === 1 ? state.streak + 1 : 1;
    const nextState = { lastClaimedDate: date, streak, totalClaimed: state.totalClaimed + 1 };

    const onboardingData = { ...(req.user.onboardingData || {}), dailyManna: nextState };
    await prisma.user.update({ where: { id: req.user.id }, data: { onboardingData } });

    res.json({ available: false, ...nextState, gift: mannaForToday(req.user.language) });
  } catch (err) { next(err); }
});

module.exports = router;
