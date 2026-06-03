/**
 * email.js — Sends OTP emails via Resend
 *
 * Uses the Resend HTTP API directly (no SDK required).
 * Set these environment variables on Render:
 *   RESEND_API_KEY   — your Resend API key (re_xxxxxxxxxxxx)
 *   EMAIL_FROM       — verified sender e.g. "ReviveSpring <noreply@yourdomain.com>"
 */

const https = require('https');

/**
 * Send a JSON POST to the Resend API
 */
function resendPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Resend error ${res.statusCode}: ${data}`));
          }
        } catch {
          reject(new Error(`Resend parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Build a beautiful bilingual OTP email
 */
function buildOtpHtml(otp, language) {
  const isFr = language === 'fr';

  const subject = isFr
    ? `${otp} — Votre code de vérification ReviveSpring`
    : `${otp} — Your ReviveSpring Verification Code`;

  const html = `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'en'}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#F5F1E8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1E8;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:520px;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1A1A2E 0%,#2a1a4e 100%);padding:36px 40px;text-align:center;">
              <div style="font-size:2.2rem;margin-bottom:8px;">✝️</div>
              <h1 style="margin:0;font-size:1.5rem;font-weight:800;color:#D4AF37;letter-spacing:2px;">REVIVESPRING</h1>
              <p style="margin:6px 0 0;font-size:.8rem;color:rgba(255,255,255,.5);letter-spacing:.1em;">
                ${isFr ? 'Revivez Votre Esprit · Renouvelez Votre Journée' : 'Revive Your Spirit · Renew Your Day'}
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;text-align:center;">
              <h2 style="margin:0 0 10px;font-size:1.2rem;color:#1A1A2E;">
                ${isFr ? 'Vérifiez votre email' : 'Verify Your Email'}
              </h2>
              <p style="margin:0 0 28px;color:#5a5a72;font-size:.9rem;line-height:1.7;">
                ${isFr
                  ? 'Entrez ce code dans l\'application ReviveSpring pour confirmer votre adresse email. Il expirera dans <strong>10 minutes</strong>.'
                  : 'Enter this code in the ReviveSpring app to confirm your email address. It expires in <strong>10 minutes</strong>.'}
              </p>

              <!-- OTP Box -->
              <div style="background:linear-gradient(135deg,rgba(212,175,55,.12),rgba(126,87,194,.08));border:2px solid rgba(212,175,55,.35);border-radius:16px;padding:28px 20px;margin-bottom:28px;display:inline-block;width:100%;box-sizing:border-box;">
                <p style="margin:0 0 8px;font-size:.75rem;font-weight:700;letter-spacing:.2em;color:#7E57C2;text-transform:uppercase;">
                  ${isFr ? 'Votre code' : 'Your code'}
                </p>
                <div style="font-size:2.8rem;font-weight:800;letter-spacing:12px;color:#1A1A2E;font-family:'Courier New',monospace;">${otp}</div>
              </div>

              <p style="margin:0 0 28px;font-size:.82rem;color:#9090a8;line-height:1.7;">
                ${isFr
                  ? 'Si vous n\'avez pas demandé ce code, vous pouvez ignorer cet email en toute sécurité.'
                  : 'If you didn\'t request this code, you can safely ignore this email.'}
              </p>

              <!-- Verse -->
              <div style="border-top:1px solid #E8E3D9;padding-top:24px;">
                <p style="margin:0;font-size:.85rem;font-style:italic;color:#7E57C2;line-height:1.7;">
                  ${isFr
                    ? '"L\'Éternel est mon berger: je ne manquerai de rien."'
                    : '"The Lord is my shepherd; I shall not want."'}
                </p>
                <p style="margin:6px 0 0;font-size:.75rem;color:#D4AF37;font-weight:700;">
                  ${isFr ? '— Psaume 23:1' : '— Psalm 23:1'}
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F5F1E8;padding:20px 40px;text-align:center;border-top:1px solid #E8E3D9;">
              <p style="margin:0;font-size:.75rem;color:#9090a8;">
                © ${new Date().getFullYear()} ReviveSpring · ${isFr ? 'Construit avec foi et amour' : 'Built with faith and love'}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/**
 * Main export — called from auth routes
 *
 * @param {string} toEmail  - recipient email address
 * @param {string} otp      - 6-digit code
 * @param {string} language - 'en' | 'fr'
 */
async function sendOtpEmail(toEmail, otp, language = 'en') {
  const apiKey = process.env.RESEND_API_KEY;
  const from   = process.env.EMAIL_FROM || 'ReviveSpring <noreply@revivespring.com>';

  if (!apiKey) {
    console.error('[EMAIL] RESEND_API_KEY is not set — skipping email send');
    // Don't throw — let registration succeed even without email config
    return;
  }

  const { subject, html } = buildOtpHtml(otp, language);

  try {
    const result = await resendPost({
      from,
      to: [toEmail],
      subject,
      html,
    });
    console.log(`[EMAIL] OTP sent to ${toEmail} — Resend ID: ${result.id}`);
    return result;
  } catch (err) {
    console.error(`[EMAIL] Failed to send OTP to ${toEmail}:`, err.message);
    // Re-throw so the route can catch it and still respond with 201
    // (the route wraps this in try/catch already)
    throw err;
  }
}

module.exports = { sendOtpEmail };
