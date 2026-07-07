'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const { openAIRequest, extractReply } = require('../services/openaiClient');
const { isPremiumUser } = require('../services/monetization');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ message: errors.array()[0].msg }); return true; }
  return false;
}

function buildPrompt(text, language) {
  const isFr = language === 'fr';
  const instructions = isFr
    ? 'Tu es le Compagnon de ReviveSpring, un soutien fidele de l application — jamais un assistant generique. A partir des ' +
      'notes ou de la retranscription d un sermon fournies par l utilisateur, renvoie UNIQUEMENT un JSON valide sous la ' +
      'forme {"summary":"resume fidele en 3-5 phrases, allant droit au message central","keyPoints":["point 1","point 2","point 3"],' +
      '"plan":[{"day":1,"title":"...","action":"une action concrete pour vivre ce point aujourd\'hui"},{"day":2,...},{"day":3,...}]}. ' +
      'Le plan doit avoir exactement 3 jours, chacun applicable directement. Reste fidele au contenu fourni; n invente rien.'
    : 'You are the ReviveSpring Companion, a faithful supporter of the app — never a generic assistant. From the sermon ' +
      'notes or transcript the user provides, return ONLY valid JSON in the shape ' +
      '{"summary":"a faithful 3-5 sentence summary getting straight to the central message","keyPoints":["point 1","point 2","point 3"],' +
      '"plan":[{"day":1,"title":"...","action":"one concrete action to live this out today"},{"day":2,...},{"day":3,...}]}. ' +
      'The plan must have exactly 3 days, each directly actionable. Stay faithful to the provided content; never invent claims.';
  return { instructions, input: [{ role: 'user', content: text }] };
}

function parseResult(raw) {
  try {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.summary === 'string') {
      return {
        summary: parsed.summary,
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 6).map(String) : [],
        plan: Array.isArray(parsed.plan)
          ? parsed.plan.slice(0, 3).map((item, index) => ({
              day: item.day || index + 1,
              title: item.title ? String(item.title) : `Day ${index + 1}`,
              action: item.action ? String(item.action) : '',
            }))
          : [],
      };
    }
  } catch (_) {
    // fall through
  }
  return { summary: raw.trim(), keyPoints: [], plan: [] };
}

router.post('/', [body('text').trim().notEmpty()], async (req, res, next) => {
  if (validate(req, res)) return;
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({ message: 'AI Sermon Summarizer is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    }

    const text = req.body.text.toString().slice(0, 6000);
    const language = (req.body.language || req.user.language || 'en').toString();

    const { instructions, input } = buildPrompt(text, language);
    const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
    const openAIRes = await openAIRequest({ model, instructions, input, max_output_tokens: 700 });
    const raw = extractReply(openAIRes);
    const result = parseResult(raw);

    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
