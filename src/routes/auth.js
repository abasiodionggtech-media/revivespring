// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { sendOtpEmail, sendSecurityAlertEmail } = require('../services/email');
const { authenticate } = require('../middleware/auth');
const { effectivePlan } = require('../services/monetization');
const {
  createDeletionFeedback,
  createNotification,
  findOtherAccountSession,
  listUserDeviceTokens,
  upsertAccountSession,
} = require('../services/supportStorage');
const { sendPushToTokens } = require('../services/push');

const router = express.Router();
const googleClient = new OAuth2Client();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function verificationLink(email) {
  const baseUrl = (process.env.WEB_APP_URL || 'https://revivespring.com').replace(/\/+$/, '');
  return `${baseUrl}/verify?email=${encodeURIComponent(email)}`;
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

function safeUser(user) {
  const { passwordHash, otpCode, otpExpiresAt, ...safe } = user;
  return {
    ...safe,
    subscriptionStatus: effectivePlan(user),
    plan: effectivePlan(user),
    hasCompletedOnboarding: !!(safe.onboardingData && typeof safe.onboardingData === 'object' && safe.onboardingData.completedAt),
  };
}

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ message: errors.array()[0].msg });
    return true;
  }
  return false;
}

async function deliverOtp(res, email, otp, language) {
  try {
    await sendOtpEmail(email, otp, language);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Verification email failed for ${email}:`, err.message);
    res.status(503).json({
      message: 'We could not send your verification email. Please try again shortly.',
    });
    return false;
  }
}

function googleAudiences() {
  return (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_WEB_CLIENT_ID || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function decodeJwtPayloadUnsafe(idToken) {
  try {
    const [, payload] = idToken.split('.');
    if (!payload) return {};
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

async function verifyGoogleToken(idToken) {
  const audiences = googleAudiences();
  if (!audiences.length) {
    const error = new Error('Google Sign-In is not configured on the server.');
    error.status = 500;
    throw error;
  }
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({ idToken, audience: audiences });
  } catch (err) {
    const payload = decodeJwtPayloadUnsafe(idToken);
    console.error('[AUTH] Google audience mismatch', {
      tokenAudience: payload.aud || null,
      configuredAudiences: audiences,
    });
    const error = new Error('Google Sign-In is using a different OAuth client ID than the backend. Update Render GOOGLE_WEB_CLIENT_ID/GOOGLE_CLIENT_IDS and rebuild the mobile app with env/release.json.');
    error.status = 401;
    throw error;
  }
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    const error = new Error('Google account did not return an email address.');
    error.status = 401;
    throw error;
  }
  if (payload.email_verified !== true) {
    const error = new Error('Google email is not verified.');
    error.status = 401;
    throw error;
  }
  return payload;
}

function clientLabel(client) {
  if (client === 'mobile') return 'the mobile app';
  if (client === 'web') return 'the web app';
  return client || 'a device';
}

async function recordSignInEvent(req, user, client = 'web') {
  try {
    const normalizedClient = ['web', 'mobile'].includes(client) ? client : 'web';
    const otherSession = await findOtherAccountSession(user.id, normalizedClient);
    const now = new Date();
    const title = otherSession ? 'Account signed in on another device' : 'New account sign-in';
    const body = otherSession
      ? `Your account is now signed in on ${clientLabel(normalizedClient)} and was already active on ${clientLabel(otherSession.client)}.`
      : `Your account was signed in on ${clientLabel(normalizedClient)}.`;

    if (otherSession) {
      await createNotification({
        userId: user.id,
        type: 'security',
        title,
        body,
        metadata: {
          client: normalizedClient,
          otherClient: otherSession.client,
          ip: req.ip,
          userAgent: req.get('user-agent') || null,
        },
      });

      try {
        const tokens = await listUserDeviceTokens(user.id);
        await sendPushToTokens(tokens, {
          title,
          body,
          data: {
            type: 'security',
            client: normalizedClient,
            otherClient: otherSession.client,
          },
        });
      } catch (err) {
        console.error(`[PUSH] Sign-in alert failed for ${user.email}:`, err.message);
      }
    }

    await upsertAccountSession({
      userId: user.id,
      client: normalizedClient,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    await sendSecurityAlertEmail(user.email, user.fullName, {
      client: clientLabel(normalizedClient),
      otherClient: otherSession ? clientLabel(otherSession.client) : null,
      when: now.toLocaleString(),
      ip: req.ip,
    });
  } catch (err) {
    console.error(`[SECURITY] Sign-in notification failed for ${user.email}:`, err.message);
  }
}

// POST /api/auth/google
router.post(
  '/google',
  [body('id_token').notEmpty().withMessage('Google ID token required.')],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const payload = await verifyGoogleToken(req.body.id_token);
      const email = payload.email.toLowerCase();
      const displayName = payload.name || email.split('@')[0] || 'Friend';
      const profileImageUrl = payload.picture || null;
      const googleSub = payload.sub || null;
      let user = await prisma.user.findUnique({ where: { email } });

      if (user && user.isDisabled) {
        return res.status(403).json({ message: 'This account has been disabled.' });
      }

      if (user && user.authProvider === 'email') {
        return res.status(409).json({
          message: 'This email is already registered with email and password. Sign in with email instead.',
        });
      }

      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            fullName: displayName,
            passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
            authProvider: 'google',
            googleSub,
            profileImageUrl,
            isEmailVerified: true,
            language: req.body.language === 'fr' ? 'fr' : 'en',
          },
        });
        await prisma.analytics.create({ data: { userId: user.id } });
      } else if (user.googleSub && googleSub && user.googleSub !== googleSub) {
        return res.status(409).json({ message: 'This Google account does not match the existing profile.' });
      } else {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            authProvider: 'google',
            isEmailVerified: true,
            otpCode: null,
            otpExpiresAt: null,
            fullName: user.fullName || displayName,
            googleSub: user.googleSub || googleSub,
            profileImageUrl,
            language: user.language || (req.body.language === 'fr' ? 'fr' : 'en'),
          },
        });
      }

      await recordSignInEvent(req, user, req.body.client || 'web');
      return res.json({ token: signToken(user.id), user: safeUser(user) });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ message: err.message });
      next(err);
    }
  }
);

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// Creates account, fires OTP email in background (never blocks on email)
// Returns 201 with token + user so Flutter can proceed to verify screen
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('full_name').notEmpty().trim().withMessage('Full name required.'),
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const { email, password, full_name } = req.body;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        if (existing.authProvider === 'google') {
          return res.status(409).json({
            message: 'This email is already linked to Google Sign-In. Use Google to continue.',
          });
        }
        if (!existing.isEmailVerified) {
          // Already registered but not verified — resend OTP and return same response
          const otp = generateOtp();
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              otpCode: otp,
              otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
            },
          });
          // Fire email in background — don't await
          if (!await deliverOtp(res, email, otp, existing.language)) return;
          return res.status(201).json({
            message: 'Account exists but email not verified. A new code has been sent.',
            requiresVerification: true,
            verifyUrl: verificationLink(email),
          });
        }
        return res.status(409).json({ message: 'Email already in use.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const otp = generateOtp();

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          authProvider: 'email',
          fullName: full_name,
          otpCode: otp,
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      // Create analytics row for new user
      await prisma.analytics.create({ data: { userId: user.id } });

      // Fire OTP email in background — NEVER block registration on email
      if (!await deliverOtp(res, email, otp, user.language)) return;

      // Return immediately with token so Flutter can navigate to verify screen
      return res.status(201).json({
        message: 'Account created. Please verify your email.',
        requiresVerification: true,
        verifyUrl: verificationLink(email),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const { email, password } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }
      if (user.isDisabled) {
        return res.status(403).json({ message: 'This account has been disabled.' });
      }
      if (user.authProvider === 'google') {
        return res.status(409).json({ message: 'This account uses Google Sign-In. Continue with Google instead.' });
      }

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return res.status(401).json({ message: 'Invalid email or password.' });
      }

      if (!user.isEmailVerified) {
        // Resend OTP in background, return 403 with verification flag
        const otp = generateOtp();
        await prisma.user.update({
          where: { id: user.id },
          data: {
            otpCode: otp,
            otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        });
        if (!await deliverOtp(res, email, otp, user.language)) return;
        return res.status(403).json({
          message: 'Email not verified. A verification code has been sent.',
          requiresVerification: true,
          verifyUrl: verificationLink(email),
        });
      }

      await recordSignInEvent(req, user, req.body.client || 'web');
      return res.json({
        token: signToken(user.id),
        user: safeUser(user),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/verify-otp ────────────────────────────────────────────────
router.post(
  '/verify-otp',
  [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits.'),
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const { email, otp } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(404).json({ message: 'User not found.' });

      if (user.otpCode !== otp) {
        return res.status(400).json({ message: 'Invalid verification code.' });
      }

      if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
        return res.status(400).json({ message: 'Code expired. Request a new one.' });
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          isEmailVerified: true,
          otpCode: null,
          otpExpiresAt: null,
        },
      });

      return res.json({
        message: 'Email verified successfully.',
        token: signToken(user.id),
        user: safeUser(updated),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/resend-otp ────────────────────────────────────────────────
router.post(
  '/resend-otp',
  [body('email').isEmail().normalizeEmail()],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const { email } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(404).json({ message: 'User not found.' });
      if (user.isEmailVerified) {
        return res.status(400).json({ message: 'Email already verified.' });
      }

      const otp = generateOtp();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          otpCode: otp,
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      if (!await deliverOtp(res, email, otp, user.language)) return;
      return res.json({
        message: 'Verification code resent.',
        verifyUrl: verificationLink(email),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    await prisma.analytics.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, visitCount: 1 },
      update: { visitCount: { increment: 1 } },
    });
    res.json(safeUser(req.user));
  } catch (err) { next(err); }
});

// ─── PATCH /api/auth/me ───────────────────────────────────────────────────────
router.patch(
  '/me',
  authenticate,
  [
    body('full_name').optional().trim().notEmpty(),
    body('language').optional().isIn(['en', 'fr']),
    body('salvationDate').optional().isString(),
    body('testimony').optional().isString(),
    body('dailyEmailEnabled').optional().isBoolean(),
    body('pushNotificationsEnabled').optional().isBoolean(),
    body('timezone').optional().isString(),
    body('reminderHour').optional().isInt({ min: 0, max: 23 }),
    body('reminderMinute').optional().isInt({ min: 0, max: 59 }),
    body('onboarding_data').optional().isObject(),
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const data = {};
      if (req.body.full_name)                   data.fullName      = req.body.full_name;
      if (req.body.language)                     data.language      = req.body.language;
      if (req.body.salvationDate !== undefined)  data.salvationDate = req.body.salvationDate;
      if (req.body.testimony     !== undefined)  data.testimony     = req.body.testimony;
      if (req.body.dailyEmailEnabled !== undefined) data.dailyEmailEnabled = req.body.dailyEmailEnabled;
      if (req.body.pushNotificationsEnabled !== undefined) data.pushNotificationsEnabled = req.body.pushNotificationsEnabled;
      if (req.body.timezone !== undefined) data.timezone = req.body.timezone || 'UTC';
      if (req.body.reminderHour !== undefined) {
        data.reminderHour = req.body.reminderHour;
        data.registeredHour = req.body.reminderHour;
      }
      if (req.body.reminderMinute !== undefined) data.reminderMinute = req.body.reminderMinute;
      if (req.body.onboarding_data !== undefined) data.onboardingData = req.body.onboarding_data;

      const user = await prisma.user.update({ where: { id: req.user.id }, data });
      return res.json(safeUser(user));
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.delete(
  '/me',
  authenticate,
  [
    body('reason').trim().isLength({ min: 3, max: 120 }).withMessage('Please share a short reason for deleting your account.'),
    body('feedback').trim().isLength({ min: 5, max: 2000 }).withMessage('Please tell us why you are leaving before deleting your account.'),
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      await createDeletionFeedback({
        userId: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        reason: req.body.reason,
        feedback: req.body.feedback,
      });
      await prisma.user.delete({ where: { id: req.user.id } });
      return res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }),
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (user.authProvider === 'google') {
        return res.status(400).json({ message: 'This account uses Google Sign-In and does not have a password to change.' });
      }
      const match = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!match) return res.status(400).json({ message: 'Current password is incorrect.' });

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
      return res.json({ message: 'Password updated successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
