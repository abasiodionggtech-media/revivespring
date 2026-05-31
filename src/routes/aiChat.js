'use strict';

/**
 * src/routes/aiChat.js
 *
 * POST /api/ai/chat
 * Body: { message, sessionId, language, userEmail? }
 *
 * Uses Google Gemini 2.5 Flash-Lite via REST API.
 * Set GEMINI_API_KEY in Render environment variables.
 */

const https  = require('https');
const prisma = require('../config/prisma');

// System prompt — loaded once
function buildSystemPrompt(language, knowledgeBase) {
  var isFr = language === 'fr';
  var kbText = '';
  if (knowledgeBase && knowledgeBase.length) {
    kbText = '\n\nKNOWLEDGE BASE (use these to answer FAQs):\n' +
      knowledgeBase.map(function(k) {
        return 'Q: ' + k.question + '\nA: ' + (isFr && k.answerFr ? k.answerFr : k.answerEn);
      }).join('\n\n');
  }

  if (isFr) {
    return 'Tu es un assistant spirituel bienveillant et compétent pour ReviveSpring, une application chrétienne de prière et de croissance spirituelle. Tu réponds toujours en français sauf si l\'utilisateur parle anglais.\n\nTES CAPACITÉS:\n- Répondre aux questions sur la Bible avec précision et compassion\n- Fournir des références de versets bibliques pertinents\n- Offrir des prières personnalisées et des encouragements\n- Expliquer des concepts théologiques de manière simple et accessible\n- Soutenir les utilisateurs dans leur parcours de foi\n- Répondre aux questions sur l\'application ReviveSpring\n\nRÈGLES:\n- Toujours citer les versets avec leur référence exacte (ex: Jean 3:16)\n- Être chaleureux, empathique et encourageant\n- Ne jamais inventer des versets bibliques — si tu n\'es pas sûr, dis-le\n- Garder les réponses concises mais complètes (200-400 mots max)\n- Ne jamais juger ou condamner l\'utilisateur\n- Si quelqu\'un semble en détresse, encourager la prière et un soutien professionnel' + kbText;
  }

  return 'You are a warm, knowledgeable spiritual assistant for ReviveSpring, a Christian prayer and spiritual growth app. You respond in English unless the user writes in French.\n\nYOUR CAPABILITIES:\n- Answer Bible questions accurately and with compassion\n- Provide relevant Bible verse references\n- Offer personalized prayers and encouragement\n- Explain theological concepts in simple, accessible language\n- Support users in their faith journey\n- Answer questions about the ReviveSpring app\n\nRULES:\n- Always cite verses with their exact reference (e.g. John 3:16)\n- Be warm, empathetic, and encouraging\n- Never invent Bible verses — if uncertain, say so honestly\n- Keep responses concise but complete (200-400 words max)\n- Never judge or condemn the user\n- If someone seems distressed, encourage prayer and professional support' + kbText;
}

// Call Gemini 2.5 Flash-Lite
function geminiRequest(payload) {
  return new Promise(function (resolve, reject) {
    var apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) { reject(new Error('GEMINI_API_KEY not set.')); return; }

    var body = JSON.stringify(payload);
    var path = '/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
    var options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try {
          var parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) { resolve(parsed); }
          else { reject(new Error('Gemini ' + res.statusCode + ': ' + data)); }
        } catch (e) { reject(new Error('Gemini parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Express route handler (used as middleware in index.js)
module.exports = async function aiChatHandler(req, res, next) {
  try {
    var message   = (req.body.message    || '').trim();
    var sessionId = (req.body.sessionId  || 'anon-' + Date.now()).toString();
    var language  = (req.body.language   || 'en').toString();
    var userEmail = (req.body.userEmail  || null);
    var history   = req.body.history || []; // [{role, content}] from client

    if (!message) return res.status(422).json({ message: 'Message is required.' });

    // Load knowledge base for context
    var knowledgeBase = [];
    try {
      knowledgeBase = await prisma.aiKnowledgeBase.findMany({ where: { isActive: true } });
    } catch (_) {}

    var systemPrompt = buildSystemPrompt(language, knowledgeBase);

    // Build Gemini contents array with history
    var contents = [];

    // Add conversation history
    if (Array.isArray(history) && history.length) {
      history.slice(-10).forEach(function (m) { // last 10 messages for context
        if (m.role === 'user' || m.role === 'model') {
          contents.push({ role: m.role, parts: [{ text: m.content }] });
        }
      });
    }

    // Add current user message
    contents.push({ role: 'user', parts: [{ text: message }] });

    var payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
        topP: 0.9,
      },
    };

    var geminiRes = await geminiRequest(payload);

    // Extract text from Gemini response
    var replyText = '';
    try {
      replyText = geminiRes.candidates[0].content.parts[0].text || '';
    } catch (_) {
      replyText = language === 'fr'
        ? "Je suis désolé, je n'ai pas pu traiter votre demande. Veuillez réessayer."
        : "I'm sorry, I couldn't process your request. Please try again.";
    }

    // Save conversation to DB (fire and forget)
    try {
      var existing = await prisma.aiConversation.findFirst({ where: { sessionId: sessionId } });
      var messages = existing ? (Array.isArray(existing.messages) ? existing.messages : []) : [];
      messages.push({ role: 'user',  content: message,   timestamp: new Date().toISOString() });
      messages.push({ role: 'model', content: replyText, timestamp: new Date().toISOString() });
      // Keep last 50 messages to avoid DB bloat
      if (messages.length > 50) messages = messages.slice(-50);

      if (existing) {
        await prisma.aiConversation.update({
          where: { id: existing.id },
          data:  { messages: messages, userEmail: userEmail || existing.userEmail },
        });
      } else {
        await prisma.aiConversation.create({
          data: { sessionId, messages, language, userEmail: userEmail || undefined },
        });
      }
    } catch (dbErr) {
      console.error('[AI-CHAT] DB save error:', dbErr.message);
    }

    res.json({ reply: replyText });
  } catch (err) {
    console.error('[AI-CHAT] Error:', err.message);
    var lang = (req.body && req.body.language) || 'en';
    res.status(500).json({
      reply: lang === 'fr'
        ? "Je rencontre des difficultés techniques. Veuillez réessayer dans un moment."
        : "I'm having technical difficulties. Please try again in a moment.",
    });
  }
};
