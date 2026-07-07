'use strict';

/**
 * src/routes/aiCompanion.js
 *
 * AI Spiritual Companion (Premium) — a single persistent chat thread per
 * user (unlike the multi-session AI Chat) that's aware of the user's
 * recent mood check-ins and prayer topics, so it feels like it "remembers"
 * them across visits. Reuses the same AiConversation table as aiChat.js,
 * under a dedicated session id, and the shared openaiClient helper.
 * aiChat.js itself is not modified.
 */

const express = require('express');
const prisma = require('../config/prisma');
const { openAIRequest, extractReply } = require('../services/openaiClient');
const { isPremiumUser } = require('../services/monetization');

const router = express.Router();

function companionSessionId(userId) {
  return `rs-companion-${userId}`;
}

async function buildMemoryContext(userId, language) {
  const [recentMoods, recentPrayers] = await Promise.all([
    prisma.moodLog.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 7 }),
    prisma.prayer.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5, select: { mood: true, createdAt: true } }),
  ]);

  const isFr = language === 'fr';
  const moodSummary = recentMoods.length
    ? recentMoods.map((m) => `${m.date}: ${m.mood}${m.note ? ` (${m.note})` : ''}`).join('; ')
    : (isFr ? 'aucune donnee recente' : 'no recent data');
  const prayerSummary = recentPrayers.length
    ? recentPrayers.map((p) => p.mood).join(', ')
    : (isFr ? 'aucune priere recente' : 'no recent prayers');

  return isFr
    ? `MEMOIRE DE L'UTILISATEUR (a utiliser avec discretion, ne pas citer mecaniquement):\n` +
      `- Etats d'ame recents (date: etat): ${moodSummary}\n` +
      `- Sujets de priere recents: ${prayerSummary}\n` +
      `Utilise ce contexte pour personnaliser ta reponse et montrer que tu te souviens du parcours de l'utilisateur, sans jamais lister ces donnees brutes dans ta reponse.`
    : `USER MEMORY (use with discretion, never recite mechanically):\n` +
      `- Recent moods (date: mood): ${moodSummary}\n` +
      `- Recent prayer topics: ${prayerSummary}\n` +
      `Use this context to personalize your response and show you remember the user's journey, without ever listing this raw data back to them.`;
}

function buildCompanionPrompt(language, memoryContext) {
  const isFr = language === 'fr';
  const base = isFr
    ? 'Tu es le Compagnon Spirituel de ReviveSpring — un accompagnement fidele et personnel, present sur la duree, jamais ' +
      'un assistant IA generique. Contrairement a une conversation ponctuelle, tu es cense te souvenir du parcours de ' +
      'l\'utilisateur et faire reference naturellement a son etat recent quand c\'est pertinent.\n\n' +
      'REGLE DE FORMAT: ta reponse entiere doit prendre la forme d\'une priere a la premiere personne adressee a Dieu, ' +
      'integrant toute information ou conseil directement dans la priere. Reste concise (80-150 mots) et va droit au but ' +
      'par rapport a ce que l\'utilisateur vient de partager.\n\n' +
      'Cite les versets avec leur reference exacte; ne jamais en inventer. Ne jamais juger l\'utilisateur.'
    : 'You are the ReviveSpring Spiritual Companion — a faithful, personal presence over time, never a generic AI ' +
      'assistant. Unlike a one-off conversation, you are expected to remember the user\'s journey and naturally reference ' +
      'their recent state when it\'s relevant.\n\n' +
      'FORMAT RULE: your entire response must take the form of a first-person prayer addressed to God, weaving any ' +
      'information or guidance directly into the prayer. Stay concise (80-150 words) and respond precisely to what the ' +
      'user just shared.\n\n' +
      'Cite verses with their exact reference; never invent one. Never judge the user.';
  return `${base}\n\n${memoryContext}`;
}

function toOpenAIInput(history, message) {
  const input = [];
  if (Array.isArray(history)) {
    history.slice(-14).forEach((item) => {
      const role = item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof item.content === 'string' ? item.content.trim() : '';
      if (content) input.push({ role, content });
    });
  }
  input.push({ role: 'user', content: message });
  return input;
}

async function loadHistory(sessionId) {
  const existing = await prisma.aiConversation.findFirst({ where: { sessionId } });
  return existing && Array.isArray(existing.messages) ? existing.messages : [];
}

async function saveConversation(sessionId, language, userEmail, message, replyText) {
  try {
    const existing = await prisma.aiConversation.findFirst({ where: { sessionId } });
    const now = new Date().toISOString();
    let messages = existing && Array.isArray(existing.messages) ? existing.messages : [];
    messages.push({ role: 'user', content: message, timestamp: now });
    messages.push({ role: 'assistant', content: replyText, timestamp: now });
    if (messages.length > 120) messages = messages.slice(-120);

    if (existing) {
      await prisma.aiConversation.update({ where: { id: existing.id }, data: { messages, language } });
    } else {
      await prisma.aiConversation.create({ data: { sessionId, messages, language, userEmail: userEmail || undefined } });
    }
  } catch (err) {
    console.error('[AI-COMPANION] save error:', err.message);
  }
}

router.get('/history', async (req, res, next) => {
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({ message: 'AI Spiritual Companion is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    }
    const sessionId = companionSessionId(req.user.id);
    const messages = await loadHistory(sessionId);
    res.json({ sessionId, messages });
  } catch (err) { next(err); }
});

router.post('/chat', async (req, res, next) => {
  const language = (req.body && req.body.language ? req.body.language : req.user.language || 'en').toString();
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({ message: 'AI Spiritual Companion is a Premium feature.', code: 'PREMIUM_REQUIRED' });
    }

    const message = (req.body.message || '').trim();
    if (!message) return res.status(422).json({ message: 'Message is required.' });

    const sessionId = companionSessionId(req.user.id);
    const history = await loadHistory(sessionId);
    const memoryContext = await buildMemoryContext(req.user.id, language);

    const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
    const payload = {
      model,
      instructions: buildCompanionPrompt(language, memoryContext),
      input: toOpenAIInput(history, message),
      max_output_tokens: 350,
    };

    const openAIRes = await openAIRequest(payload);
    const replyText = extractReply(openAIRes) || (
      language === 'fr'
        ? "Seigneur, meme quand les mots me manquent, je sais que Tu entends mon coeur. Aide-moi a reessayer. Amen."
        : "Lord, even when the words don't come, I know You hear my heart. Help me try again. Amen."
    );

    await saveConversation(sessionId, language, req.user.email, message, replyText);
    res.json({ reply: replyText, sessionId });
  } catch (err) {
    console.error('[AI-COMPANION] Error:', err.message);
    const status = err.status || 500;
    res.status(status).json({
      message: err.message,
      reply: language === 'fr'
        ? "Seigneur, nous rencontrons une difficulte technique. Aide-nous a reessayer dans un instant. Amen."
        : "Lord, we're facing a technical hiccup. Help us try again in a moment. Amen.",
    });
  }
});

module.exports = router;
