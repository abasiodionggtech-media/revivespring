'use strict';

/**
 * email.js — OTP emails via Resend HTTP API
 *
 * Required Render environment variables:
 *   RESEND_API_KEY  — your key starting with re_
 *   EMAIL_FROM      — e.g. "ReviveSpring <noreply@yourdomain.com>"
 */

const https = require('https');

/* ── Resend HTTP POST ───────────────────────────────────────── */
function resendPost(payload) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify(payload);
    var options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error('Resend ' + res.statusCode + ': ' + data));
          }
        } catch (e) {
          reject(new Error('Resend parse error: ' + data));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ── Build OTP email ────────────────────────────────────────── */
function buildEmail(otp, language) {
  var isFr = language === 'fr';

  var subject = isFr
    ? (otp + ' — Votre code de verification ReviveSpring')
    : (otp + ' — Your ReviveSpring Verification Code');

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#F5F1E8;font-family:Arial,sans-serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1E8;padding:40px 20px;">'
    + '<tr><td align="center">'
    + '<table width="100%" style="max-width:520px;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'

    + '<tr><td style="background:linear-gradient(135deg,#1A1A2E,#2a1a4e);padding:36px 40px;text-align:center;">'
    + '<div style="font-size:2rem;margin-bottom:8px;">&#10013;&#65039;</div>'
    + '<h1 style="margin:0;font-size:1.4rem;font-weight:800;color:#D4AF37;letter-spacing:2px;">REVIVESPRING</h1>'
    + '<p style="margin:6px 0 0;font-size:.8rem;color:rgba(255,255,255,.5);">'
    + (isFr ? 'Revivez Votre Esprit' : 'Revive Your Spirit')
    + '</p></td></tr>'

    + '<tr><td style="padding:36px 40px;text-align:center;">'
    + '<h2 style="margin:0 0 10px;font-size:1.1rem;color:#1A1A2E;">'
    + (isFr ? 'Verifiez votre email' : 'Verify Your Email')
    + '</h2>'
    + '<p style="margin:0 0 28px;color:#5a5a72;font-size:.9rem;line-height:1.7;">'
    + (isFr
        ? 'Entrez ce code dans ReviveSpring. Il expire dans <strong>10 minutes</strong>.'
        : 'Enter this code in ReviveSpring. It expires in <strong>10 minutes</strong>.')
    + '</p>'

    + '<div style="background:rgba(212,175,55,.1);border:2px solid rgba(212,175,55,.35);border-radius:16px;padding:28px 20px;margin-bottom:28px;">'
    + '<p style="margin:0 0 8px;font-size:.75rem;font-weight:700;letter-spacing:.2em;color:#7E57C2;text-transform:uppercase;">'
    + (isFr ? 'Votre code' : 'Your code')
    + '</p>'
    + '<div style="font-size:2.8rem;font-weight:800;letter-spacing:12px;color:#1A1A2E;font-family:monospace;">' + otp + '</div>'
    + '</div>'

    + '<p style="margin:0 0 28px;font-size:.82rem;color:#9090a8;line-height:1.7;">'
    + (isFr
        ? "Si vous n'avez pas demande ce code, ignorez cet email."
        : "If you didn't request this code, you can safely ignore this email.")
    + '</p>'

    + '<div style="border-top:1px solid #E8E3D9;padding-top:24px;">'
    + '<p style="margin:0;font-size:.85rem;font-style:italic;color:#7E57C2;">'
    + (isFr ? '"L\'Eternel est mon berger: je ne manquerai de rien."' : '"The Lord is my shepherd; I shall not want."')
    + '</p>'
    + '<p style="margin:6px 0 0;font-size:.75rem;color:#D4AF37;font-weight:700;">'
    + (isFr ? '— Psaume 23:1' : '— Psalm 23:1')
    + '</p></div>'
    + '</td></tr>'

    + '<tr><td style="background:#F5F1E8;padding:16px 40px;text-align:center;border-top:1px solid #E8E3D9;">'
    + '<p style="margin:0;font-size:.72rem;color:#9090a8;">'
    + '&copy; ' + new Date().getFullYear() + ' ReviveSpring'
    + '</p></td></tr>'

    + '</table></td></tr></table></body></html>';

  return { subject: subject, html: html };
}

/* ── sendOtpEmail ───────────────────────────────────────────── */
async function sendOtpEmail(toEmail, otp, language) {
  var apiKey = process.env.RESEND_API_KEY;
  var from   = process.env.EMAIL_FROM || 'ReviveSpring <noreply@revivespring.com>';

  if (!apiKey) {
    console.error('[EMAIL] RESEND_API_KEY not set — skipping send');
    return;
  }

  var email = buildEmail(otp, language || 'en');

  var result = await resendPost({
    from:    from,
    to:      [toEmail],
    subject: email.subject,
    html:    email.html
  });

  console.log('[EMAIL] OTP sent to ' + toEmail + ' — id: ' + result.id);
  return result;
}

/* ── safeSendOtpEmail ───────────────────────────────────────── */
async function safeSendOtpEmail(toEmail, otp, language) {
  try {
    await sendOtpEmail(toEmail, otp, language);
  } catch (err) {
    console.error('[EMAIL] Failed to send to ' + toEmail + ':', err.message);
  }
}

module.exports = { sendOtpEmail: sendOtpEmail, safeSendOtpEmail: safeSendOtpEmail };
