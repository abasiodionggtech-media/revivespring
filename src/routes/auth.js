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

async function safeSendOtpEmail(email, otp, lang = 'en') {
  try {
    await sendOtpEmail(email, otp, lang);
    return true;
  } catch (err) {
    console.error('[EMAIL] Unable to send OTP email:', err);
    return false;
  }
}

function fireAndForgetOtpEmail(email, otp, lang = 'en') {
  safeSendOtpEmail(email, otp, lang).then((sent) => {
    if (!sent) {
      console.warn(`[EMAIL] OTP was not sent to ${email}. Continuing registration without blocking.`);
    }
  });
}

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ message: errors.array()[0].msg });
    return true;
  }
  return false;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
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
        // If they exist but unverified, resend OTP
        if (!existing.isEmailVerified) {
          const otp = generateOtp();
          await prisma.user.update({
            where: { id: existing.id },
            data: {
              otpCode: otp,
              otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
            },
          });
          const emailSent = await safeSendOtpEmail(email, otp, existing.language);
          return res.status(400).json({
            message: emailSent
              ? 'Email not verified. A new code has been sent.'
              : 'Email not verified. We could not send a new code. Please contact support.',
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

      // Create analytics row
      await prisma.analytics.create({ data: { userId: user.id } });

      fireAndForgetOtpEmail(email, otp, user.language);

      res.status(201).json({
        message: 'Account created. Please verify via email when available.',
        token: signToken(user.id),
        user: safeUser(user),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/request-otp ───────────────────────────────────────────────
router.post(
  '/request-otp',
  [body('email').isEmail().normalizeEmail()],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const { email } = req.body;

      let user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        // Create a lightweight account placeholder for OTP flows (no password)
        const passwordHash = await bcrypt.hash('', 12);
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            fullName: '',
            otpCode: null,
            otpExpiresAt: null,
          },
        });
        await prisma.analytics.create({ data: { userId: user.id } });
      }

      const otp = generateOtp();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          otpCode: otp,
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const emailSent = await safeSendOtpEmail(email, otp, user.language);

      // Return a token so the app can continue with a temporary session
      const token = signToken(user.id);

      return res.json({
        message: emailSent ? 'OTP sent.' : 'OTP stored but email delivery failed.',
        token,
        user: safeUser(user),
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
        // Resend OTP
        const otp = generateOtp();
        await prisma.user.update({
          where: { id: user.id },
          data: {
            otpCode: otp,
            otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        });
        const emailSent = await safeSendOtpEmail(email, otp, user.language);
        return res.status(403).json({
          message: emailSent
            ? 'Email not verified. A verification code has been sent.'
            : 'Email not verified. We could not send your verification code. Please contact support.',
        });
      }

      res.json({
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
        return res.status(400).json({ message: 'Verification code has expired. Request a new one.' });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          isEmailVerified: true,
          otpCode: null,
          otpExpiresAt: null,
        },
      });

      res.json({ message: 'Email verified successfully.', token: signToken(user.id) });
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
      const emailSent = await safeSendOtpEmail(email, otp, user.language);
      res.json({
        message: emailSent
          ? 'Verification code resent.'
          : 'Verification code updated but email delivery failed. Please contact support.',
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  res.json(safeUser(req.user));
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
  ],
  async (req, res, next) => {
    if (handleValidation(req, res)) return;
    try {
      const allowed = ['fullName', 'language', 'salvationDate', 'testimony'];
      const data = {};
      if (req.body.full_name) data.fullName = req.body.full_name;
      if (req.body.language) data.language = req.body.language;
      if (req.body.salvationDate !== undefined) data.salvationDate = req.body.salvationDate;
      if (req.body.testimony !== undefined) data.testimony = req.body.testimony;

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data,
      });
      res.json(safeUser(user));
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
      res.json({ message: 'Password updated successfully.' });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
