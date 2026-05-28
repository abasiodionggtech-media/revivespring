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
const adminRoutes     = require('./routes/admin');          // ← NEW
const { authenticate }      = require('./middleware/auth');
const { authenticateAdmin } = require('./middleware/adminAuth'); // ← NEW
const prisma = require('./config/prisma');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Request ID logging
app.use((req, res, next) => {
  const id = uuidv4();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  console.log(`[${id}] --> ${req.method} ${req.originalUrl}`);
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[${id}] <-- ${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now()-start}ms`);
  });
  next();
});

// Security
app.use(helmet());

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX        || '200',   10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { message: 'Too many requests, please slow down.' },
});
app.use('/api', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { message: 'Too many auth attempts. Try again later.' },
});

// Body parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Routes ──────────────────────────────────────────────
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/prayers',   authenticate, prayerRoutes);
app.use('/api/journal',   authenticate, journalRoutes);
app.use('/api/goals',     authenticate, goalRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/admin',     adminRoutes);  // admin routes handle their own auth internally

// ─── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

// ─── Global Error Handler ─────────────────────────────────
app.use((err, req, res, _next) => {
  const id = req && req.id ? req.id : 'no-id';
  console.error(`[ERROR][${id}]`, err.stack || err);
  if (err && err.name === 'PrismaClientKnownRequestError') {
    console.error(`[PRISMA][${id}] code=${err.code} meta=${JSON.stringify(err.meta)}`);
  }
  const status = err.status || 500;
  const safeMessage = process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message;
  res.status(status).json({
    message: safeMessage,
    requestId: id,
    prismaCode: (process.env.NODE_ENV === 'production' ? undefined : (err && err.code) || undefined),
  });
});

// ─── Start ────────────────────────────────────────────────
(async () => {
  try {
    await prisma.$connect();
    console.log('✅ Prisma connected to the database.');
  } catch (err) {
    console.error('[DB][ERROR] Could not connect:', err.message || err);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✝  ReviveSpring API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Admin panel: /api/admin/* (requires admin role)`);
  });
})();

module.exports = app;
