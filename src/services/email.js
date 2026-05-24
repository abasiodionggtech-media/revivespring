const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOtpEmail(email, otp, lang = 'en') {
  const isEn = lang !== 'fr';

  const subject = isEn ? 'Your ReviveMe Verification Code' : 'Votre code de vérification ReviveMe';

  const html = `
  <!DOCTYPE html>
  <html>
  <head><meta charset="UTF-8"/></head>
  <body style="font-family:Georgia,serif;background:#0D0B0E;color:#F0EAD6;margin:0;padding:40px;">
    <div style="max-width:500px;margin:0 auto;text-align:center;">
      <h1 style="color:#D4AF37;font-size:24px;letter-spacing:4px;">✝ REVIVEME</h1>
      <p style="color:#8A8090;margin-bottom:32px;">
        ${isEn ? 'Revive Your Spirit. Renew Your Day.' : 'Revivez Votre Esprit. Renouvelez Votre Journée.'}
      </p>
      <div style="background:#16131A;border:1px solid rgba(212,175,55,0.3);border-radius:16px;padding:32px;">
        <p style="font-size:16px;margin-bottom:24px;">
          ${isEn ? 'Your verification code is:' : 'Votre code de vérification est:'}
        </p>
        <div style="background:linear-gradient(135deg,#D4AF37,#7E57C2);border-radius:12px;padding:20px;margin:0 auto 24px;display:inline-block;min-width:160px;">
          <span style="color:white;font-size:36px;font-weight:bold;letter-spacing:10px;">${otp}</span>
        </div>
        <p style="color:#8A8090;font-size:13px;">
          ${isEn ? 'This code expires in 10 minutes.' : 'Ce code expire dans 10 minutes.'}
        </p>
      </div>
      <p style="color:#8A8090;font-size:11px;margin-top:24px;">
        ${isEn ? 'If you did not request this, please ignore this email.' : 'Si vous n\'avez pas demandé ceci, veuillez ignorer cet email.'}
      </p>
    </div>
  </body>
  </html>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'ReviveMe <noreply@reviveme.app>',
    to: email,
    subject,
    html,
  });
}

module.exports = { sendOtpEmail };
