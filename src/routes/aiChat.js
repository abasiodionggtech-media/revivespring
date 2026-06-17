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
    return 'Tu es un assistant spirituel bienveillant et competent pour ReviveSpring, une application chretienne de priere et de croissance spirituelle. Tu reponds toujours en francais sauf si l utilisateur parle anglais.\n\n' +
      'TES CAPACITES:\n' +
      '- Repondre aux questions sur la Bible avec precision et compassion\n' +
      '- Fournir des references de versets bibliques pertinents\n' +
      '- Offrir des prieres personnalisees et des encouragements\n' +
      '- Expliquer des concepts theologiques de maniere simple et accessible\n' +
      '- Soutenir les utilisateurs dans leur parcours de foi\n' +
      '- Repondre aux questions sur l application ReviveSpring\n\n' +
      'REGLES:\n' +
      '- Toujours citer les versets avec leur reference exacte, par exemple Jean 3:16\n' +
      '- Etre chaleureux, empathique et encourageant\n' +
      '- Ne jamais inventer des versets bibliques; si tu n es pas sur, dis-le\n' +
      '- Garder les reponses concises mais completes, environ 200 a 400 mots maximum\n' +
      '- Ne jamais juger ou condamner l utilisateur\n' +
      '- Si quelqu un semble en detresse, encourager la priere et un soutien professionnel' +
      kbText;
  }

  return 'You are a warm, knowledgeable spiritual assistant for ReviveSpring, a Christian prayer and spiritual growth app. You respond in English unless the user writes in French.\n\n' +
    'YOUR CAPABILITIES:\n' +
    '- Answer Bible questions accurately and with compassion\n' +
    '- Provide relevant Bible verse references\n' +
    '- Offer personalized prayers and encouragement\n' +
    '- Explain theological concepts in simple, accessible language\n' +
    '- Support users in their faith journey\n' +
    '- Answer questions about the ReviveSpring app\n\n' +
    'RULES:\n' +
    '- Always cite verses with their exact reference, for example John 3:16\n' +
    '- Be warm, empathetic, and encouraging\n' +
    '- Never invent Bible verses; if uncertain, say so honestly\n' +
    '- Keep responses concise but complete, about 200 to 400 words maximum\n' +
    '- Never judge or condemn the user\n' +
    '- If someone seems distressed, encourage prayer and professional support' +
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

    const model = process.env.OPENAI_MODEL || 'gpt-5.4';
    const payload = {
      model,
      instructions: buildSystemPrompt(language, knowledgeBase),
      input: toOpenAIInput(history, message),
      max_output_tokens: 900,
    };
    if ((process.env.OPENAI_REASONING_EFFORT || '').trim()) {
      payload.reasoning = { effort: process.env.OPENAI_REASONING_EFFORT.trim() };
    }

    const openAIRes = await openAIRequest(payload);
    const replyText = extractReply(openAIRes) || (
      language === 'fr'
        ? "Je suis desole, je n'ai pas pu traiter votre demande. Veuillez reessayer."
        : "I'm sorry, I couldn't process your request. Please try again."
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
        ? "Je rencontre des difficultes techniques. Veuillez reessayer dans un moment."
        : "I'm having technical difficulties. Please try again in a moment.",
    });
  }
});

module.exports = router;
