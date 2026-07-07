'use strict';

/**
 * src/routes/mentalHealth.js
 *
 * Public read endpoints for the existing (admin-managed) MentalHealthContent
 * table — there wasn't previously a user-facing route for it. Also adds a
 * dedicated Grief & Crisis Support endpoint that combines grief-category
 * content with accurate, current crisis hotline resources.
 */

const express = require('express');
const prisma = require('../config/prisma');
const { isPremiumUser } = require('../services/monetization');

const router = express.Router();

function formatContent(item, language) {
  const isFr = language === 'fr';
  return {
    id: item.id,
    category: item.category,
    title: isFr && item.titleFr ? item.titleFr : item.titleEn,
    content: isFr && item.contentFr ? item.contentFr : item.contentEn,
    audio_url: item.audioUrl,
    is_premium: item.isPremium,
  };
}

// Crisis resources — kept accurate and reviewed; US-specific.
// If you're outside the US, please search for your local emergency or
// crisis line, as these numbers only connect within the United States.
const CRISIS_RESOURCES_EN = [
  { name: '988 Suicide & Crisis Lifeline', detail: 'Call or text 988, or chat at 988lifeline.org. Free, confidential, available 24/7.' },
  { name: 'Crisis Text Line', detail: 'Text HOME to 741741 to reach a trained crisis counselor, free and 24/7.' },
];
const CRISIS_RESOURCES_FR = [
  { name: '988 Suicide & Crisis Lifeline (Etats-Unis)', detail: 'Appelez ou envoyez un texto au 988, ou discutez sur 988lifeline.org. Gratuit, confidentiel, 24h/24.' },
  { name: 'Crisis Text Line (Etats-Unis)', detail: 'Envoyez HOME par texto au 741741 pour joindre un conseiller de crise forme, gratuit et 24h/24.' },
];

// GET /api/mental-health-content?category=grief
router.get('/', async (req, res, next) => {
  try {
    const language = (req.query.language || req.user.language || 'en').toString();
    const category = req.query.category ? req.query.category.toString() : undefined;
    const premium = isPremiumUser(req.user);

    const items = await prisma.mentalHealthContent.findMany({
      where: {
        isVisible: true,
        ...(category ? { category } : {}),
        ...(premium ? {} : { isPremium: false }),
      },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });

    res.json(items.map((item) => formatContent(item, language)));
  } catch (err) { next(err); }
});

// GET /api/mental-health-content/crisis-support — always free, always available
router.get('/crisis-support', async (req, res, next) => {
  try {
    const language = (req.query.language || req.user.language || 'en').toString();
    const items = await prisma.mentalHealthContent.findMany({
      where: { isVisible: true, category: 'grief' },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({
      content: items.map((item) => formatContent(item, language)),
      resources: language === 'fr' ? CRISIS_RESOURCES_FR : CRISIS_RESOURCES_EN,
      note: language === 'fr'
        ? 'Si vous etes en dehors des Etats-Unis, recherchez votre ligne d urgence ou de crise locale.'
        : "If you're outside the United States, please search for your local emergency or crisis line.",
    });
  } catch (err) { next(err); }
});

module.exports = router;
