'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { openAIRequest, extractReply } = require('../services/openaiClient');
const { isPremiumUser } = require('../services/monetization');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function mapEntry(e) {
  return {
    id: e.id,
    title: e.title,
    content: e.content,
    ai_interpretation: e.aiInterpretation,
    tags: e.tags,
    created_date: e.createdDate || e.createdAt.toISOString().split('T')[0],
  };
}

function buildPrompt(description, language) {
  const isFr = language === 'fr';
  const instructions = isFr
    ? 'Tu es le Compagnon de ReviveSpring, un soutien fidele de l application — jamais un assistant generique. L utilisateur ' +
      'decrit un reve ou une vision. Offre une reflexion spirituelle prudente et encourageante (100-160 mots) qui explore ' +
      'un sens possible a la lumiere de themes bibliques generaux, SANS jamais affirmer une interpretation certaine ou ' +
      'prophetique. Rappelle doucement que le discernement final revient a la priere et, si besoin, a des conseillers de ' +
      'confiance. Renvoie UNIQUEMENT du JSON valide: {"interpretation":"..."}.'
    : 'You are the ReviveSpring Companion, a faithful supporter of the app — never a generic assistant. The user describes ' +
      'a dream or vision. Offer a careful, encouraging spiritual reflection (100-160 words) exploring a possible meaning ' +
      'in light of general biblical themes, WITHOUT ever claiming a certain or prophetic interpretation. Gently remind them ' +
      'that final discernment belongs to prayer and, where needed, trusted counsel. Return ONLY valid JSON: ' +
      '{"interpretation":"..."}.';
  return { instructions, input: [{ role: 'user', content: description }] };
}

function parseInterpretation(raw) {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.interpretation === 'string' && parsed.interpretation.trim()) {
      return parsed.interpretation.trim();
    }
  } catch (_) {
    // fall through
  }
  return raw.trim();
}

// GET /api/dream-journal — dream/vision entries only
router.get('/', async (req, res, next) => {
  try {
    const entries = await prisma.journalEntry.findMany({
      where: { userId: req.user.id, tags: { has: 'dream' } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(entries.map(mapEntry));
  } catch (err) { next(err); }
});

// POST /api/dream-journal — { description } -> saves entry + AI interpretation
router.post('/', [body('description').trim().notEmpty()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({ message: 'AI Dream/Vision Journal is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    }

    const description = req.body.description.toString().slice(0, 2000);
    const language = (req.body.language || req.user.language || 'en').toString();

    const { instructions, input } = buildPrompt(description, language);
    const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
    const openAIRes = await openAIRequest({ model, instructions, input, max_output_tokens: 400 });
    const interpretation = parseInterpretation(extractReply(openAIRes));

    const entry = await prisma.journalEntry.create({
      data: {
        userId: req.user.id,
        title: req.body.title?.toString().slice(0, 80) || (language === 'fr' ? 'Reve / Vision' : 'Dream / Vision'),
        content: description,
        aiInterpretation: interpretation,
        tags: ['dream'],
        language,
        createdDate: new Date().toISOString().split('T')[0],
      },
    });

    res.status(201).json(mapEntry(entry));
  } catch (err) { next(err); }
});

module.exports = router;
