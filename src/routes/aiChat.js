'use strict';

/**
 * AI chat + conversation memory endpoints
 *
 * POST /api/ai/chat
 * GET  /api/ai/history?sessionId=...
 * GET  /api/ai/sessions
 */

const express = require('express');
const https = require('https');
const prisma = require('../config/prisma');
const { authenticate } = require('../middleware/auth');
const {
  isPremiumUser,
  aiUsageForToday,
  localDateForTimeZone,
  mergeUserMeta,
  readUserMeta,
} = require('../services/monetization');

const router = express.Router();

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildSystemPrompt(language, knowledgeBase) {
  const isFr = language === 'fr';
  let kbText = '';

  if (knowledgeBase && knowledgeBase.length) {
    kbText = '\n\nKNOWLEDGE BASE (use these to answer ReviveSpring FAQs):\n' +
      knowledgeBase.map((k) => {
        const answer = isFr && k.answerFr ? k.answerFr : k.answerEn;
        return `Q: ${k.question}\nA: ${answer}`;
      }).join('\n\n');
  }

  if (isFr) {
    return 'Tu es le Compagnon de priere de ReviveSpring — un soutien chaleureux et fidele de l application ReviveSpring, ' +
      'jamais un assistant IA generique. Tu paries toujours du cote de l utilisateur, avec l esperance et la compassion ' +
      'd un ami de confiance dans la foi. Tu reponds toujours en francais sauf si l utilisateur ecrit en anglais.\n\n' +
      'REGLE LA PLUS IMPORTANTE — FORMAT DE REPONSE OBLIGATOIRE:\n' +
      'Quelle que soit la question ou la demande, ta reponse ENTIERE doit toujours prendre la forme d une priere adressee ' +
      'a Dieu, a la premiere personne (comme si tu priais avec l utilisateur). Ne donne jamais une reponse explicative ou ' +
      'une liste ordinaire; integre l information ou l encouragement demande DIRECTEMENT a l interieur de la priere elle-meme. ' +
      'Si l utilisateur pose une question factuelle sur l application ou la Bible, reponds a cette question a travers le ' +
      'contenu de la priere (par exemple en remerciant Dieu pour cette verite ou en la citant dans la priere), sans jamais ' +
      'sortir du format priere.\n\n' +
      'STYLE:\n' +
      '- Va droit au but: reponds precisement a ce que l utilisateur vient de partager, sans detour ni remplissage\n' +
      '- Reste court: 80 a 150 mots maximum, sauf si l utilisateur demande explicitement plus de details\n' +
      '- Cite les versets avec leur reference exacte quand c est pertinent, par exemple Jean 3:16; ne jamais inventer un verset\n' +
      '- Ne jamais juger ou condamner l utilisateur\n' +
      '- Si quelqu un semble en detresse, prie specifiquement pour cette detresse et encourage doucement un soutien professionnel' +
      kbText;
  }

  return 'You are the ReviveSpring Prayer Companion — a warm, faithful supporter of the ReviveSpring app, never a generic ' +
    'AI assistant. You are always on the user\'s side, offering the hope and compassion of a trusted friend in faith. You ' +
    'respond in English unless the user writes in French.\n\n' +
    'MOST IMPORTANT RULE — MANDATORY RESPONSE FORMAT:\n' +
    'No matter what the user asks or shares, your ENTIRE response must always take the form of a prayer addressed to God, ' +
    'spoken in first person (as if praying together with the user). Never give a plain explanatory answer or an ordinary ' +
    'list; weave whatever information, verse, or encouragement was requested DIRECTLY into the prayer itself. If the user ' +
    'asks a factual question about the app or the Bible, answer it through the content of the prayer (for example, ' +
    'thanking God for that truth or quoting it within the prayer) — never break out of the prayer format.\n\n' +
    'STYLE:\n' +
    '- Get straight to the point: respond precisely to what the user just shared, no filler or throat-clearing\n' +
    '- Keep it short: 80-150 words maximum, unless the user explicitly asks for more detail\n' +
    '- Cite verses with their exact reference when relevant, e.g. John 3:16; never invent a verse\n' +
    '- Never judge or condemn the user\n' +
    '- If someone seems distressed, pray specifically into that distress and gently encourage professional support' +
    kbText;
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

function extractReply(data) {
  if (data && typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const output = Array.isArray(data && data.output) ? data.output : [];
  const chunks = [];
  output.forEach((item) => {
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((part) => {
      if (typeof part.text === 'string') chunks.push(part.text);
      if (typeof part.output_text === 'string') chunks.push(part.output_text);
    });
  });
  return chunks.join('\n').trim();
}

function openAIRequest(payload) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY is not set.'));

    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/responses',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
          const message = parsed && parsed.error && parsed.error.message ? parsed.error.message : data;
          reject(new Error(`OpenAI ${res.statusCode}: ${message}`));
        } catch (_) {
          reject(new Error(`OpenAI parse error: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function saveConversation({ sessionId, language, userEmail, message, replyText }) {
  try {
    const email = normalizeEmail(userEmail) || null;
    const existing = await prisma.aiConversation.findFirst({ where: { sessionId } });
    const now = new Date().toISOString();
    let messages = existing ? (Array.isArray(existing.messages) ? existing.messages : []) : [];
    messages.push({ role: 'user', content: message, timestamp: now });
    messages.push({ role: 'assistant', content: replyText, timestamp: now });
    if (messages.length > 120) messages = messages.slice(-120);

    if (existing) {
      await prisma.aiConversation.update({
        where: { id: existing.id },
        data: { messages, userEmail: email || existing.userEmail || null, language },
      });
      return existing.id;
    }

    const created = await prisma.aiConversation.create({
      data: { sessionId, messages, language, userEmail: email || undefined },
    });
    return created.id;
  } catch (err) {
    console.error('[AI-CHAT] DB save error:', err.message);
    return null;
  }
}

async function consumeAiUnlock(user, unlockToken) {
  if (isPremiumUser(user)) return user;
  const meta = readUserMeta(user);
  const unlock = meta.aiUnlock && typeof meta.aiUnlock === 'object' ? meta.aiUnlock : null;
  const today = localDateForTimeZone(new Date(), user.timezone || 'UTC');
  if (!unlock || !unlockToken || unlock.token !== unlockToken || unlock.date !== today) {
    const error = new Error('Watch a short ad before using AI today.');
    error.status = 403;
    error.code = 'AI_AD_REQUIRED';
    throw error;
  }

  const usage = aiUsageForToday(user);
  const nextMeta = mergeUserMeta(user, {
    aiUsage: { date: usage.date, used: usage.used + 1 },
    aiUnlock: null,
  });
  return prisma.user.update({
    where: { id: user.id },
    data: { onboardingData: nextMeta },
  });
}

router.use(authenticate);

router.get('/history', async (req, res) => {
  try {
    const sessionId = (req.query.sessionId || '').toString().trim();
    if (!sessionId) {
      return res.status(422).json({ message: 'sessionId is required.' });
    }

    const conversation = await prisma.aiConversation.findFirst({
      where: { sessionId, userEmail: normalizeEmail(req.user.email) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, sessionId: true, userEmail: true, language: true, messages: true, updatedAt: true, createdAt: true },
    });

    if (!conversation) return res.json({ messages: [], sessionId, conversation: null });
    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    res.json({ sessionId: conversation.sessionId, conversation, messages });
  } catch (err) {
    console.error('[AI-CHAT] history error:', err.message);
    res.status(500).json({ message: 'Unable to load conversation history.' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const userEmail = normalizeEmail(req.user.email);
    const rows = await prisma.aiConversation.findMany({
      where: { userEmail },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, sessionId: true, updatedAt: true, createdAt: true, messages: true },
    });

    const sessions = rows.map((row) => {
      const messages = Array.isArray(row.messages) ? row.messages : [];
      const last = messages.length ? messages[messages.length - 1] : null;
      return {
        id: row.id,
        sessionId: row.sessionId,
        updatedAt: row.updatedAt,
        createdAt: row.createdAt,
        preview: last && typeof last.content === 'string' ? last.content.slice(0, 120) : 'Conversation',
        messageCount: messages.length,
      };
    });
    res.json({ sessions });
  } catch (err) {
    console.error('[AI-CHAT] sessions error:', err.message);
    res.status(500).json({ message: 'Unable to load conversations.' });
  }
});

router.post('/chat', async (req, res) => {
  const language = (req.body && req.body.language ? req.body.language : req.user.language || 'en').toString();
  let workingUser = req.user;
  try {
    const message = (req.body.message || '').trim();
    const sessionId = (req.body.sessionId || `rs-user-${req.user.id}-${Date.now()}`).toString();
    const history = req.body.history || [];
    if (!message) return res.status(422).json({ message: 'Message is required.' });

    if (!isPremiumUser(workingUser)) {
      workingUser = await consumeAiUnlock(workingUser, (req.body.unlockToken || '').toString());
    }

    let knowledgeBase = [];
    try {
      knowledgeBase = await prisma.aiKnowledgeBase.findMany({ where: { isActive: true } });
    } catch (_) {}

    const model = process.env.OPENAI_MODEL || 'gpt-5.4-nano';
    const payload = {
      model,
      instructions: buildSystemPrompt(language, knowledgeBase),
      input: toOpenAIInput(history, message),
      max_output_tokens: 350,
    };
    if ((process.env.OPENAI_REASONING_EFFORT || '').trim()) {
      payload.reasoning = { effort: process.env.OPENAI_REASONING_EFFORT.trim() };
    }

    const openAIRes = await openAIRequest(payload);
    const replyText = extractReply(openAIRes) || (
      language === 'fr'
        ? "Seigneur, meme quand les mots me manquent, je sais que Tu entends mon coeur. Aide-moi a reessayer et donne-moi la clarte dont j'ai besoin. Amen."
        : "Lord, even when the words don't come, I know You hear my heart. Help me try again, and give me the clarity I need right now. Amen."
    );

    await saveConversation({
      sessionId,
      language,
      userEmail: workingUser.email,
      message,
      replyText,
    });
    res.json({ reply: replyText, provider: 'openai', model, sessionId });
  } catch (err) {
    console.error('[AI-CHAT] Error:', err.message);
    const status = err.status || 500;
    res.status(status).json({
      message: err.message,
      code: err.code,
      reply: language === 'fr'
        ? "Seigneur, nous rencontrons une difficulte technique en ce moment. Merci de veiller sur nous quand meme; aide-nous a reessayer dans un instant. Amen."
        : "Lord, we're facing a technical hiccup right now. Thank You for watching over us anyway — help us try again in a moment. Amen.",
    });
  }
});

module.exports = router;
