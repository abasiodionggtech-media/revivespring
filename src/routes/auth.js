// src/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const prisma = require('../config/prisma');
const { sendOtpEmail } = require('../services/email');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

function safeUser(user) {
  const { passwordHash, otpCode, otpExpiresAt, ...safe } = user;
  return safe;
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
            token: signToken(existing.id),
            user: safeUser(existing),
            requiresVerification: true,
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
        token: signToken(user.id),
        user: safeUser(user),
        requiresVerification: true,
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
          token: signToken(user.id),
          user: safeUser(user),
        });
      }

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
      return res.json({ message: 'Verification code resent.' });
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
      if (req.body.onboarding_data !== undefined) data.onboardingData = req.body.onboarding_data;

      const user = await prisma.user.update({ where: { id: req.user.id }, data });
      return res.json(safeUser(user));
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/change-password ──────────────────────────────────────────
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
