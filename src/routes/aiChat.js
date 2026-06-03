'use strict';

/**
 * POST /api/ai/chat
 * Body: { message, sessionId, language, userEmail?, history? }
 *
 * Uses OpenAI through the backend only. Set OPENAI_API_KEY in Render.
 * Optional: OPENAI_MODEL=gpt-5.4
 */

const https = require('https');
const prisma = require('../config/prisma');

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
    return 'Tu es un assistant spirituel bienveillant et compétent pour ReviveSpring, une application chrétienne de prière et de croissance spirituelle. Tu réponds toujours en français sauf si l’utilisateur parle anglais.\n\n' +
      'TES CAPACITÉS:\n' +
      '- Répondre aux questions sur la Bible avec précision et compassion\n' +
      '- Fournir des références de versets bibliques pertinents\n' +
      '- Offrir des prières personnalisées et des encouragements\n' +
      '- Expliquer des concepts théologiques de manière simple et accessible\n' +
      '- Soutenir les utilisateurs dans leur parcours de foi\n' +
      '- Répondre aux questions sur l’application ReviveSpring\n\n' +
      'RÈGLES:\n' +
      '- Toujours citer les versets avec leur référence exacte, par exemple Jean 3:16\n' +
      '- Être chaleureux, empathique et encourageant\n' +
      '- Ne jamais inventer des versets bibliques; si tu n’es pas sûr, dis-le\n' +
      '- Garder les réponses concises mais complètes, environ 200 à 400 mots maximum\n' +
      '- Ne jamais juger ou condamner l’utilisateur\n' +
      '- Si quelqu’un semble en détresse, encourager la prière et un soutien professionnel' +
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
    history.slice(-10).forEach((item) => {
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
    if (!apiKey) {
      reject(new Error('OPENAI_API_KEY is not set.'));
      return;
    }

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
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const message = parsed && parsed.error && parsed.error.message ? parsed.error.message : data;
            reject(new Error(`OpenAI ${res.statusCode}: ${message}`));
          }
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
    const existing = await prisma.aiConversation.findFirst({ where: { sessionId } });
    let messages = existing ? (Array.isArray(existing.messages) ? existing.messages : []) : [];

    messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });
    messages.push({ role: 'assistant', content: replyText, timestamp: new Date().toISOString() });
    if (messages.length > 50) messages = messages.slice(-50);

    if (existing) {
      await prisma.aiConversation.update({
        where: { id: existing.id },
        data: { messages, userEmail: userEmail || existing.userEmail },
      });
    } else {
      await prisma.aiConversation.create({
        data: { sessionId, messages, language, userEmail: userEmail || undefined },
      });
    }
  } catch (err) {
    console.error('[AI-CHAT] DB save error:', err.message);
  }
}

module.exports = async function aiChatHandler(req, res) {
  const language = (req.body && req.body.language ? req.body.language : 'en').toString();

  try {
    const message = (req.body.message || '').trim();
    const sessionId = (req.body.sessionId || `anon-${Date.now()}`).toString();
    const userEmail = req.body.userEmail || null;
    const history = req.body.history || [];

    if (!message) return res.status(422).json({ message: 'Message is required.' });

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
        ? "Je suis désolé, je n'ai pas pu traiter votre demande. Veuillez réessayer."
        : "I'm sorry, I couldn't process your request. Please try again."
    );

    await saveConversation({ sessionId, language, userEmail, message, replyText });
    res.json({ reply: replyText, provider: 'openai', model });
  } catch (err) {
    console.error('[AI-CHAT] Error:', err.message);
    res.status(500).json({
      reply: language === 'fr'
        ? "Je rencontre des difficultés techniques. Veuillez réessayer dans un moment."
        : "I'm having technical difficulties. Please try again in a moment.",
    });
  }
};
