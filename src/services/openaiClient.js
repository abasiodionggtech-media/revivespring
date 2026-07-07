'use strict';

/**
 * src/services/openaiClient.js
 *
 * Minimal shared helper for calling OpenAI's Responses API. Extracted so
 * new AI endpoints (Topical Scripture Search, AI Prayer Writer) don't have
 * to duplicate the request/response plumbing already used by aiChat.js.
 * aiChat.js itself is left untouched and keeps its own copies.
 */

const https = require('https');

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

module.exports = { openAIRequest, extractReply };
