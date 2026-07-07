'use strict';

/**
 * src/routes/scriptureSearch.js
 *
 * POST /api/scripture-search
 * Topical Scripture Search — free users get 3 searches/day, standard and
 * premium users get unlimited. AI picks real, relevant Bible verses for a
 * topic (e.g. "dealing with fear", "forgiveness").
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { openAIRequest, extractReply } = require('../services/openaiClient');
const { isPaidUser, dailyUsageFor, mergeUserMeta } = require('../services/monetization');

const router = express.Router();
const FREE_DAILY_LIMIT = 3;
const USAGE_KEY = 'scriptureSearchUsage';

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function buildPrompt(topic, language) {
  const isFr = language === 'fr';
  const instructions = isFr
    ? 'Tu es le Compagnon de priere de ReviveSpring, un soutien fidele de l application ReviveSpring — jamais un assistant ' +
      'IA generique. Pour le sujet donne par l utilisateur, renvoie UNIQUEMENT un JSON valide (pas de texte autour) sous la forme ' +
      '{"results":[{"reference":"Livre Chapitre:Verset","verse":"texte du verset","note":"une phrase courte expliquant le lien avec le sujet"}],' +
      '"closingPrayer":"une priere courte (40-70 mots) a la premiere personne qui rassemble ces versets autour du sujet exact de l utilisateur"}. ' +
      'Fournis 4 a 6 versets reels et directement pertinents pour ce sujet precis — va droit au but, sans versets generiques hors-sujet. ' +
      'Ne jamais inventer de versets, de references, ou de theme non demande.'
    : 'You are the ReviveSpring Prayer Companion, a faithful supporter of the ReviveSpring app — never a generic AI assistant. ' +
      'For the topic the user gives, return ONLY valid JSON (no surrounding text) in the shape ' +
      '{"results":[{"reference":"Book Chapter:Verse","verse":"the verse text","note":"one short sentence on why it fits the exact topic"}],' +
      '"closingPrayer":"a short first-person prayer (40-70 words) that ties these verses back to the user\'s exact topic"}. ' +
      'Provide 4 to 6 real verses directly relevant to this specific topic — get straight to the point, no generic off-topic verses. ' +
      'Never invent verses, references, or an unrelated theme.';
  return { instructions, input: [{ role: 'user', content: topic }] };
}

function parseResults(raw) {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const results = Array.isArray(parsed.results)
      ? parsed.results
          .filter((item) => item && item.reference && item.verse)
          .slice(0, 6)
          .map((item) => ({
            reference: String(item.reference),
            verse: String(item.verse),
            note: item.note ? String(item.note) : '',
          }))
      : [];
    const closingPrayer = typeof parsed.closingPrayer === 'string' ? parsed.closingPrayer.trim() : '';
    return { results, closingPrayer };
  } catch (_) {
    // fall through
  }
  return { results: [], closingPrayer: '' };
}

router.get('/status', async (req, res, next) => {
  try {
    const paid = isPaidUser(req.user);
    if (paid) return res.json({ remainingToday: null, limit: null, isPaid: true });
    const usage = dailyUsageFor(req.user, USAGE_KEY);
    res.json({
      remainingToday: Math.max(0, FREE_DAILY_LIMIT - usage.used),
      limit: FREE_DAILY_LIMIT,
      isPaid: false,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', [body('topic').trim().notEmpty()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    const topic = req.body.topic.toString().slice(0, 200);
    const language = (req.body.language || req.user.language || 'en').toString();
    const paid = isPaidUser(req.user);

    let workingUser = req.user;
    if (!paid) {
      const usage = dailyUsageFor(req.user, USAGE_KEY);
      if (usage.used >= FREE_DAILY_LIMIT) {
        return res.status(403).json({
          message: 'Daily search limit reached for free users.',
          code: 'SEARCH_DAILY_LIMIT_REACHED',
          remainingToday: 0,
          limit: FREE_DAILY_LIMIT,
        });
      }
      const nextMeta = mergeUserMeta(req.user, {
        [USAGE_KEY]: { date: usage.date, used: usage.used + 1 },
      });
      workingUser = await prisma.user.update({ where: { id: req.user.id }, data: { onboardingData: nextMeta } });
    }

    const { instructions, input } = buildPrompt(topic, language);
    const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
    const openAIRes = await openAIRequest({ model, instructions, input, max_output_tokens: 550 });
    const raw = extractReply(openAIRes);
    const { results, closingPrayer } = parseResults(raw);

    const usage = paid ? null : dailyUsageFor(workingUser, USAGE_KEY);
    res.json({
      topic,
      results,
      closingPrayer,
      remainingToday: paid ? null : Math.max(0, FREE_DAILY_LIMIT - (usage ? usage.used : 0)),
      limit: paid ? null : FREE_DAILY_LIMIT,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
