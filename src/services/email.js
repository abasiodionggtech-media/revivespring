'use strict';

/**
 * src/services/email.js
 * Handles all outbound emails via Resend HTTP API.
 *
 * Exports:
 *   sendOtpEmail(toEmail, otp, language)
 *   safeSendOtpEmail(toEmail, otp, language)   — never throws
 *   sendDailyPrayerEmail(toEmail, name, prayer, language)
 */

var https = require('https');

// ─── Core HTTP POST to Resend ─────────────────────────────────
function resendPost(payload) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify(payload);
    var options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
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
          else { reject(new Error('Resend ' + res.statusCode + ': ' + data)); }
        } catch (e) { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getFrom() {
  return process.env.RESEND_FROM || process.env.EMAIL_FROM || 'ReviveSpring <noreply@revivespring.com>';
}

// ─── OTP Email ────────────────────────────────────────────────
function buildOtpHtml(otp, language) {
  var isFr = language === 'fr';
  var subject = isFr
    ? (otp + ' - Votre code de verification ReviveSpring')
    : (otp + ' - Your ReviveSpring Verification Code');

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>'
    + '<body style="margin:0;padding:0;background:#F5F1E8;font-family:Arial,sans-serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1E8;padding:40px 16px;">'
    + '<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:#fff;border-radius:20px;overflow:hidden;">'
    + '<tr><td style="background:#1A1A2E;padding:32px 40px;text-align:center;">'
    + '<h1 style="margin:0;font-size:22px;font-weight:900;color:#D4AF37;letter-spacing:3px;">REVIVESPRING</h1>'
    + '<p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.5);">' + (isFr ? 'Revivez Votre Esprit' : 'Revive Your Spirit') + '</p>'
    + '</td></tr>'
    + '<tr><td style="padding:36px 40px;text-align:center;">'
    + '<h2 style="margin:0 0 12px;font-size:18px;color:#1A1A2E;">' + (isFr ? 'Verifiez votre email' : 'Verify Your Email') + '</h2>'
    + '<p style="margin:0 0 24px;color:#5a5a72;font-size:14px;line-height:1.7;">' + (isFr ? 'Code expire dans 10 minutes.' : 'Code expires in 10 minutes.') + '</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#fdf8ec;border:2px solid #D4AF37;border-radius:16px;padding:24px;text-align:center;">'
    + '<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:3px;color:#7E57C2;text-transform:uppercase;">' + (isFr ? 'Votre code' : 'Your code') + '</p>'
    + '<p style="margin:0;font-size:40px;font-weight:900;letter-spacing:14px;color:#1A1A2E;font-family:monospace;">' + otp + '</p>'
    + '</td></tr></table>'
    + '<p style="margin:20px 0 0;font-size:12px;color:#9090a8;">' + (isFr ? "Si vous n'avez pas demande ce code, ignorez cet email." : "If you didn't request this, ignore this email.") + '</p>'
    + '</td></tr>'
    + '<tr><td style="background:#F5F1E8;padding:16px;text-align:center;border-top:1px solid #E8E3D9;">'
    + '<p style="margin:0;font-size:11px;color:#9090a8;">Copyright ' + new Date().getFullYear() + ' ReviveSpring</p>'
    + '</td></tr>'
    + '</table></td></tr></table></body></html>';

  return { subject: subject, html: html };
}

async function sendOtpEmail(toEmail, otp, language) {
  if (!process.env.RESEND_API_KEY) { console.error('[EMAIL] RESEND_API_KEY not set'); return; }
  var email = buildOtpHtml(otp, language || 'en');
  var result = await resendPost({ from: getFrom(), to: [toEmail], subject: email.subject, html: email.html });
  console.log('[EMAIL] OTP sent to ' + toEmail + ' id:' + result.id);
  return result;
}

async function safeSendOtpEmail(toEmail, otp, language) {
  try { await sendOtpEmail(toEmail, otp, language); }
  catch (err) { console.error('[EMAIL] safeSendOtpEmail failed for ' + toEmail + ':', err.message); }
}

// ─── Daily Prayer Email ───────────────────────────────────────
function buildDailyPrayerHtml(name, prayer, language) {
  var isFr    = language === 'fr';
  var greeting = isFr ? ('Bonjour ' + (name || 'ami') + ',') : ('Hello ' + (name || 'friend') + ',');
  var tagline  = isFr ? 'Votre prière quotidienne vous attend' : 'Your daily prayer is waiting';
  var subject  = isFr ? ('Votre prière du jour — ' + new Date().toLocaleDateString('fr-FR', {weekday:'long',month:'long',day:'numeric'}))
                       : ('Your Daily Prayer — ' + new Date().toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'}));
  var moodLabel = prayer.mood ? (prayer.mood.charAt(0).toUpperCase() + prayer.mood.slice(1)) : 'Daily';
  var actionLabel = isFr ? 'Étape d\'action' : 'Action Step';
  var footerText  = isFr ? 'Vous recevez cet email parce que vous avez activé les prières quotidiennes. Connectez-vous pour gérer vos préférences.'
                          : 'You are receiving this because you enabled daily prayers. Sign in to manage your preferences.';
  var unsubText   = isFr ? 'Se désabonner' : 'Unsubscribe';

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>'
    + '<body style="margin:0;padding:0;background:#F5F1E8;font-family:Georgia,serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1E8;padding:40px 16px;">'
    + '<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">'

    // Header
    + '<tr><td style="background:linear-gradient(135deg,#1A1A2E,#2a1a4e);padding:36px 40px;text-align:center;">'
    + '<p style="margin:0 0 8px;font-size:28px;">&#10013;&#65039;</p>'
    + '<h1 style="margin:0;font-size:22px;font-weight:900;color:#D4AF37;letter-spacing:3px;font-family:Georgia,serif;">REVIVESPRING</h1>'
    + '<p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.5);font-family:Arial,sans-serif;">' + tagline + '</p>'
    + '</td></tr>'

    // Greeting
    + '<tr><td style="padding:32px 40px 0;">'
    + '<p style="margin:0 0 4px;font-size:13px;color:#7E57C2;font-family:Arial,sans-serif;font-weight:700;letter-spacing:2px;text-transform:uppercase;">' + moodLabel + '</p>'
    + '<p style="margin:0 0 20px;font-size:16px;color:#1A1A2E;font-family:Arial,sans-serif;">' + greeting + '</p>'
    + '</td></tr>'

    // Verse
    + '<tr><td style="padding:0 40px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:linear-gradient(135deg,rgba(212,175,55,0.1),rgba(126,87,194,0.06));border-left:4px solid #D4AF37;border-radius:0 12px 12px 0;padding:20px 24px;">'
    + '<p style="margin:0 0 6px;font-size:15px;font-style:italic;color:#7E57C2;line-height:1.7;">"' + (prayer.verse || '') + '"</p>'
    + '<p style="margin:0;font-size:12px;font-weight:700;color:#D4AF37;letter-spacing:1px;font-family:Arial,sans-serif;">— ' + (prayer.ref || '') + '</p>'
    + '</td></tr></table>'
    + '</td></tr>'

    // Prayer
    + '<tr><td style="padding:24px 40px 0;">'
    + '<p style="margin:0;font-size:15px;line-height:2;color:#2a2a3e;white-space:pre-line;">' + (prayer.prayer || '') + '</p>'
    + '</td></tr>'

    // Action step
    + '<tr><td style="padding:20px 40px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:rgba(126,87,194,0.08);border-left:3px solid #7E57C2;border-radius:0 10px 10px 0;padding:16px 20px;">'
    + '<p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:2px;color:#7E57C2;text-transform:uppercase;font-family:Arial,sans-serif;">&#10022; ' + actionLabel + '</p>'
    + '<p style="margin:0;font-size:14px;color:#2a2a3e;font-family:Arial,sans-serif;line-height:1.6;">' + (prayer.action || '') + '</p>'
    + '</td></tr></table>'
    + '</td></tr>'

    // CTA
    + '<tr><td style="padding:0 40px 32px;text-align:center;">'
    + '<a href="https://revivespring.com" style="display:inline-block;background:linear-gradient(135deg,#D4AF37,#7E57C2);color:#fff;text-decoration:none;padding:14px 32px;border-radius:50px;font-size:14px;font-weight:700;font-family:Arial,sans-serif;letter-spacing:1px;">'
    + (isFr ? 'Ouvrir ReviveSpring' : 'Open ReviveSpring')
    + '</a>'
    + '</td></tr>'

    // Footer
    + '<tr><td style="background:#F5F1E8;padding:20px 40px;text-align:center;border-top:1px solid #E8E3D9;">'
    + '<p style="margin:0 0 6px;font-size:11px;color:#9090a8;font-family:Arial,sans-serif;">' + footerText + '</p>'
    + '<p style="margin:0;font-size:11px;font-family:Arial,sans-serif;"><a href="https://revivespring.com" style="color:#D4AF37;">' + unsubText + '</a> &middot; Copyright ' + new Date().getFullYear() + ' ReviveSpring</p>'
    + '</td></tr>'

    + '</table></td></tr></table></body></html>';

  return { subject: subject, html: html };
}

async function sendDailyPrayerEmail(toEmail, name, prayer, language) {
  if (!process.env.RESEND_API_KEY) { console.error('[EMAIL] RESEND_API_KEY not set'); return; }
  var email = buildDailyPrayerHtml(name, prayer, language || 'en');
  var result = await resendPost({ from: getFrom(), to: [toEmail], subject: email.subject, html: email.html });
  console.log('[EMAIL] Daily prayer sent to ' + toEmail + ' id:' + result.id);
  return result;
}

module.exports = {
  sendOtpEmail:        sendOtpEmail,
  safeSendOtpEmail:    safeSendOtpEmail,
  sendDailyPrayerEmail: sendDailyPrayerEmail,
};
