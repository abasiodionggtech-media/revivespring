const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

/**
 * Middleware: verify JWT and attach req.user
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ message: 'User not found.' });
    if (user.isDisabled) return res.status(403).json({ message: 'Account disabled.' });
    if (!user.isEmailVerified) {
      return res.status(403).json({ message: 'Email not verified.' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired.' });
    }
    return res.status(401).json({ message: 'Invalid token.' });
  }
}

/**
 * Middleware: require premium subscription
 */
function requirePremium(req, res, next) {
  if (req.user.subscriptionStatus !== 'premium') {
    return res.status(403).json({ message: 'Premium subscription required.' });
  }
  next();
}

module.exports = { authenticate, requirePremium };
