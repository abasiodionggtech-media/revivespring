require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes      = require('./routes/auth');
const prayerRoutes    = require('./routes/prayers');
const journalRoutes   = require('./routes/journal');
const goalRoutes      = require('./routes/goals');
const analyticsRoutes = require('./routes/analytics');
const { authenticate } = require('./middleware/auth');
const prisma = require('./config/prisma');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust the proxy (Render uses a reverse proxy, otherwise rate limiter sees wrong client IPs)
app.set('trust proxy', 1);

// Request ID + basic request/response logging for easier debugging in logs
app.use((req, res, next) => {
  const id = uuidv4();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  console.log(`[${id}] --> ${req.method} ${req.originalUrl}`);
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${id}] <-- ${res.statusCode} ${req.method} ${req.originalUrl} ${ms}ms`);
  });
  next();
});

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS — allow ALL origins (mobile apps have no origin header) ─────────────
app.use(cors({
  origin: '*',          // Mobile apps don't send an Origin header — must be *
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors()); // Handle preflight for all routes

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please slow down.' },
});
app.use('/api', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many auth attempts. Try again later.' },
});

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/prayers',   authenticate, prayerRoutes);
app.use('/api/journal',   authenticate, journalRoutes);
app.use('/api/goals',     authenticate, goalRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const id = req && req.id ? req.id : 'no-id';
  console.error(`[ERROR][${id}]`, err.stack || err);

  // Prisma errors often contain useful code/meta for debugging
  if (err && err.name === 'PrismaClientKnownRequestError') {
    console.error(`[PRISMA][${id}] code=${err.code} meta=${JSON.stringify(err.meta)}`);
  }

  const status = err.status || 500;
  const safeMessage = process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message;
  res.status(status).json({
    message: safeMessage,
    requestId: id,
    // Expose Prisma code in non-production for easier debugging
    prismaCode: (process.env.NODE_ENV === 'production' ? undefined : (err && err.code) || undefined),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await prisma.$connect();
    console.log('✅ Prisma connected to the database.');
  } catch (err) {
    console.error('[DB][ERROR] Could not connect to the database at startup:', err.message || err);
    console.error('Make sure DATABASE_URL is set and migrations have been applied (run `npm run migrate:deploy`).');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✝  ReviveMe API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Database URL present: ${process.env.DATABASE_URL ? 'yes' : 'no'}`);
  });
})();

module.exports = app;
