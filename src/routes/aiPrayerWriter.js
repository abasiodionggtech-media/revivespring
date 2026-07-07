'use strict';

/**
 * src/routes/aiPrayerWriter.js
 *
 * POST /api/ai-prayer-writer
 * Premium-only: describe a situation, get back a personalized written
 * prayer. Saved as a Prayer record so it shows up alongside other prayers
 * (and can be marked answered later, feeding the Answered Prayer Wall).
 */

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

function buildPrompt(description, language) {
  const isFr = language === 'fr';
  const instructions = isFr
    ? 'Tu es le Redacteur de prieres de ReviveSpring, un soutien fidele et chaleureux de l application ReviveSpring — jamais ' +
      'un assistant IA generique. A partir de la situation decrite par l utilisateur, ecris une priere personnalisee qui va ' +
      'droit au coeur du sujet (ne pas t egarer dans des generalites). Reste concise: 100-160 mots, en francais, adressee ' +
      'a Dieu a la premiere personne. Renvoie UNIQUEMENT du JSON valide sous la forme ' +
      '{"prayer":"...","verseRef":"Livre Chapitre:Verset","verse":"texte du verset le plus pertinent"}. ' +
      'Choisis un verset biblique reel et directement pertinent; ne jamais en inventer.'
    : 'You are the ReviveSpring Prayer Writer, a faithful, warm supporter of the ReviveSpring app — never a generic AI ' +
      'assistant. Based on the situation the user describes, write a personalized prayer that goes straight to the heart ' +
      'of what they shared (no generic filler). Keep it concise: 100-160 words, in English, addressed to God in first ' +
      'person. Return ONLY valid JSON in the shape ' +
      '{"prayer":"...","verseRef":"Book Chapter:Verse","verse":"the most relevant verse text"}. Choose one real verse ' +
      'directly relevant to the situation; never invent one.';
  return { instructions, input: [{ role: 'user', content: description }] };
}

function parseResult(raw) {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.prayer === 'string' && parsed.prayer.trim()) {
      return {
        prayer: parsed.prayer.trim(),
        verseRef: parsed.verseRef ? String(parsed.verseRef) : null,
        verse: parsed.verse ? String(parsed.verse) : null,
      };
    }
  } catch (_) {
    // fall through — treat the raw text as the prayer itself
  }
  return { prayer: raw.trim(), verseRef: null, verse: null };
}

router.post('/', [body('description').trim().notEmpty()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({
        message: 'AI Prayer Writer is a Premium feature.',
        code: 'PREMIUM_REQUIRED',
      });
    }

    const description = req.body.description.toString().slice(0, 800);
    const language = (req.body.language || req.user.language || 'en').toString();

    const { instructions, input } = buildPrompt(description, language);
    const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
    const openAIRes = await openAIRequest({ model, instructions, input, max_output_tokens: 450 });
    const raw = extractReply(openAIRes);
    const { prayer, verseRef, verse } = parseResult(raw);

    const saved = await prisma.prayer.create({
      data: {
        userId: req.user.id,
        mood: 'ai_prayer_writer',
        prayerText: prayer,
        bibleVerse: verse,
        bibleReference: verseRef,
        language,
        createdDate: new Date().toISOString().split('T')[0],
      },
    });

    res.json({
      id: saved.id,
      prayer,
      verseRef,
      verse,
      description,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
