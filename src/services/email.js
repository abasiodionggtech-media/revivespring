'use strict';

const https = require('https');
const nodemailer = require('nodemailer');

let smtpTransport;

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getFrom() {
  return process.env.EMAIL_FROM
    || process.env.RESEND_FROM
    || process.env.SMTP_USER
    || 'ReviveSpring <noreply@revivespring.com>';
}

function getSmtpTransport() {
  if (!smtpTransport) {
    const port = Number(process.env.SMTP_PORT || 587);
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return smtpTransport;
}

function resendPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          reject(new Error(`Resend returned an unreadable response: ${data}`));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`Resend ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendMail({ to, subject, html }) {
  if (hasSmtpConfig()) {
    const result = await getSmtpTransport().sendMail({
      from: getFrom(),
      to,
      subject,
      html,
    });
    console.log(`[EMAIL] SMTP accepted message for ${to} id:${result.messageId}`);
    return result;
  }

  if (process.env.RESEND_API_KEY) {
    const result = await resendPost({
      from: getFrom(),
      to: [to],
      subject,
      html,
    });
    console.log(`[EMAIL] Resend accepted message for ${to} id:${result.id}`);
    return result;
  }

  throw new Error('Email transport is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and EMAIL_FROM on Render.');
}

async function verifyEmailTransport() {
  if (hasSmtpConfig()) {
    await getSmtpTransport().verify();
    console.log('[EMAIL] SMTP transport is ready.');
    return;
  }
  if (process.env.RESEND_API_KEY) {
    console.log('[EMAIL] Resend transport is configured.');
    return;
  }
  throw new Error('No email transport configured.');
}

function buildOtpHtml(otp, language, emailAddress) {
  const isFr = language === 'fr';
  const subject = isFr
    ? `${otp} - Votre code de verification ReviveSpring`
    : `${otp} - Your ReviveSpring verification code`;
  const baseUrl = (process.env.WEB_APP_URL || 'https://revivespring.com').replace(/\/+$/, '');
  const verifyUrl = `${baseUrl}/verify?email=${encodeURIComponent(emailAddress || '')}`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f5f9f7;font-family:Arial,sans-serif;color:#173a33;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f5f9f7;">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;overflow:hidden;background:#ffffff;border-radius:14px;">
          <tr><td style="padding:28px 36px;text-align:center;background:#0e4b3e;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:2px;">REVIVESPRING</h1>
            <p style="margin:6px 0 0;color:#dcebe7;font-size:12px;">${isFr ? 'Revivez votre esprit' : 'Revive your spirit'}</p>
          </td></tr>
          <tr><td style="padding:34px 36px;text-align:center;">
            <h2 style="margin:0 0 10px;font-size:20px;">${isFr ? 'Verifiez votre email' : 'Verify your email'}</h2>
            <p style="margin:0 0 22px;color:#6d7f79;font-size:14px;">${isFr ? 'Ce code expire dans 10 minutes.' : 'This code expires in 10 minutes.'}</p>
            <div style="padding:20px;border:2px solid #3f8f48;border-radius:10px;background:#f5f9f7;">
              <p style="margin:0;color:#0e4b3e;font-family:monospace;font-size:38px;font-weight:900;letter-spacing:12px;">${escapeHtml(otp)}</p>
            </div>
            <p style="margin:20px 0 0;color:#48625a;font-size:14px;">${isFr ? 'Ou ouvrez directement votre page de verification:' : 'Or open your verification page directly:'}</p>
            <p style="margin:8px 0 0;"><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0e4b3e;color:#ffffff;text-decoration:none;font-weight:700;">${isFr ? 'Verifier mon compte' : 'Verify my account'}</a></p>
            <p style="margin:20px 0 0;color:#6d7f79;font-size:12px;">${isFr ? "Si vous n'avez pas demande ce code, ignorez cet email." : "If you did not request this code, ignore this email."}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}

async function sendOtpEmail(toEmail, otp, language) {
  const email = buildOtpHtml(otp, language || 'en', toEmail);
  return sendMail({ to: toEmail, subject: email.subject, html: email.html });
}

async function safeSendOtpEmail(toEmail, otp, language) {
  try {
    return await sendOtpEmail(toEmail, otp, language);
  } catch (err) {
    console.error(`[EMAIL] Could not send OTP to ${toEmail}:`, err.message);
    return null;
  }
}

function buildDailyPrayerHtml(name, prayer, language) {
  const isFr = language === 'fr';
  const safeName = escapeHtml(name || (isFr ? 'ami' : 'friend'));
  const safePrayer = escapeHtml(prayer.prayer);
  const safeVerse = escapeHtml(prayer.verse);
  const safeRef = escapeHtml(prayer.ref);
  const safeAction = escapeHtml(prayer.action);
  const subject = isFr ? 'Votre priere ReviveSpring du jour' : 'Your daily ReviveSpring prayer';

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f5f9f7;font-family:Arial,sans-serif;color:#173a33;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f5f9f7;">
      <tr><td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;overflow:hidden;background:#ffffff;border-radius:14px;">
          <tr><td style="padding:28px 36px;text-align:center;background:#0e4b3e;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:2px;">REVIVESPRING</h1>
          </td></tr>
          <tr><td style="padding:30px 36px;">
            <p style="margin:0 0 16px;">${isFr ? 'Bonjour' : 'Hello'} ${safeName},</p>
            <blockquote style="margin:0 0 18px;padding:14px 16px;border-left:4px solid #3f8f48;background:#f5f9f7;color:#0e4b3e;">
              "${safeVerse}"<br/><strong>${safeRef}</strong>
            </blockquote>
            <p style="white-space:pre-line;line-height:1.7;">${safePrayer}</p>
            <p style="padding:14px 16px;background:#f5f9f7;"><strong>${isFr ? "Etape d'action" : 'Action step'}:</strong><br/>${safeAction}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html };
}

async function sendDailyPrayerEmail(toEmail, name, prayer, language) {
  const email = buildDailyPrayerHtml(name, prayer, language || 'en');
  return sendMail({ to: toEmail, subject: email.subject, html: email.html });
}

async function sendSecurityAlertEmail(toEmail, name, details = {}) {
  const safeName = escapeHtml(name || 'Friend');
  const isFr = details.language === 'fr';
  const safeClient = escapeHtml(details.client || 'a device');
  const safeOtherClient = details.otherClient ? escapeHtml(details.otherClient) : null;
  const safeWhen = escapeHtml(details.when || new Date().toLocaleString());
  const safeIp = escapeHtml(details.ip || 'Unknown');
  const otherClientLine = safeOtherClient
    ? `<p style="padding:14px 16px;background:#fff8ec;border-left:4px solid #d8963d;"><strong>${isFr ? 'Note de securite' : 'Security note'}:</strong> ${isFr ? 'Ce compte etait deja actif sur' : 'This account was already active on'} ${safeOtherClient}.</p>`
    : '';
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f9f7;font-family:Arial,sans-serif;color:#173a33;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f5f9f7;"><tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;overflow:hidden;background:#ffffff;border-radius:14px;">
        <tr><td style="padding:28px 36px;text-align:center;background:#0e4b3e;"><h1 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:2px;">REVIVESPRING</h1></td></tr>
        <tr><td style="padding:30px 36px;"><h2 style="margin:0 0 10px;">${isFr ? 'Nouvelle connexion a votre compte' : 'New sign-in to your account'}</h2>
          <p>${isFr ? 'Bonjour' : 'Hello'} ${safeName}, ${isFr ? 'votre compte ReviveSpring a ete connecte sur' : 'your ReviveSpring account was signed in on'} ${safeClient}.</p>
          ${otherClientLine}
          <p style="padding:14px 16px;background:#f5f9f7;border-left:4px solid #3f8f48;"><strong>Time:</strong> ${safeWhen}<br/><strong>IP:</strong> ${safeIp}</p>
          <p style="color:#6d7f79;font-size:13px;">${isFr ? "Si c'etait bien vous, aucune action n'est necessaire. Si ce n'etait pas vous, changez votre mot de passe immediatement et contactez le service client." : 'If this was you, no action is needed. If this was not you, please change your password immediately and contact customer care.'}</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  return sendMail({
    to: toEmail,
    subject: isFr
      ? 'Nouvelle connexion a votre compte ReviveSpring'
      : 'New ReviveSpring account sign-in',
    html,
  });
}

async function sendSupportReplyEmail(toEmail, name, ticket, reply) {
  const safeName = escapeHtml(name || 'Friend');
  const safeSubject = escapeHtml(ticket.subject || 'Customer care message');
  const safeReply = escapeHtml(reply);
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f9f7;font-family:Arial,sans-serif;color:#173a33;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f5f9f7;"><tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;overflow:hidden;background:#ffffff;border-radius:14px;">
        <tr><td style="padding:28px 36px;text-align:center;background:#0e4b3e;"><h1 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:2px;">REVIVESPRING CARE</h1></td></tr>
        <tr><td style="padding:30px 36px;"><p>Hello ${safeName},</p><h2 style="margin:0 0 10px;">We replied to: ${safeSubject}</h2>
          <p style="white-space:pre-line;line-height:1.7;padding:14px 16px;background:#f5f9f7;border-left:4px solid #3f8f48;">${safeReply}</p>
          <p style="color:#6d7f79;font-size:13px;">Open ReviveSpring notifications or Customer Care to view this response.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  return sendMail({ to: toEmail, subject: 'ReviveSpring Care replied to your message', html });
}

module.exports = {
  sendOtpEmail,
  safeSendOtpEmail,
  sendDailyPrayerEmail,
  sendSecurityAlertEmail,
  sendSupportReplyEmail,
  verifyEmailTransport,
};
