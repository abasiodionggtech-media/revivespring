'use strict';
const express = require('express');
const prisma = require('../config/prisma');

const router = express.Router();
const today = () => new Date().toISOString().split('T')[0];

function formatDeclaration(d) {
  return { id: d.id, text: d.textEn, text_fr: d.textFr, category: d.category };
}

function declarationState(onboardingData) {
  const state = (onboardingData && onboardingData.declarationStreak) || {};
  return { lastConfirmedDate: state.lastConfirmedDate || null, streak: state.streak || 0 };
}

async function pickTodaysDeclaration() {
  const declarations = await prisma.declaration.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  if (!declarations.length) return null;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return declarations[dayOfYear % declarations.length];
}

// GET /api/declarations/today
router.get('/today', async (req, res, next) => {
  try {
    const declaration = await pickTodaysDeclaration();
    if (!declaration) return res.status(404).json({ message: 'No declarations configured.' });
    const state = declarationState(req.user.onboardingData);
    res.json({
      declaration: formatDeclaration(declaration),
      confirmedToday: state.lastConfirmedDate === today(),
      streak: state.streak,
    });
  } catch (err) { next(err); }
});

// POST /api/declarations/confirm — "I declare this over my life today"
router.post('/confirm', async (req, res, next) => {
  try {
    const date = today();
    const state = declarationState(req.user.onboardingData);
    if (state.lastConfirmedDate === date) {
      return res.json({ confirmedToday: true, streak: state.streak });
    }
    const previous = state.lastConfirmedDate ? new Date(`${state.lastConfirmedDate}T00:00:00Z`) : null;
    const current = new Date(`${date}T00:00:00Z`);
    const diff = previous ? Math.round((current - previous) / 86400000) : null;
    const streak = diff === 1 ? state.streak + 1 : 1;

    const onboardingData = { ...(req.user.onboardingData || {}), declarationStreak: { lastConfirmedDate: date, streak } };
    await prisma.user.update({ where: { id: req.user.id }, data: { onboardingData } });

    res.json({ confirmedToday: true, streak });
  } catch (err) { next(err); }
});

module.exports = router;
