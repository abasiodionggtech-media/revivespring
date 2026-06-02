require('dotenv').config();
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const rateLimit= require('express-rate-limit');

const authRoutes      = require('./routes/auth');
const prayerRoutes    = require('./routes/prayers');
const journalRoutes   = require('./routes/journal');
const goalRoutes      = require('./routes/goals');
const analyticsRoutes = require('./routes/analytics');
const onboardingRoutes= require('./routes/onboarding');
const libraryRoutes   = require('./routes/library');
const dailyVerseRoutes= require('./routes/dailyVerse');
const adminRoutes     = require('./routes/admin');
const { authenticate }      = require('./middleware/auth');
const { authenticateAdmin } = require('./middleware/adminAuth');
const prisma = require('./config/prisma');
const { runDailyPrayerEmailJob } = require('./jobs/dailyPrayerEmail');
const { verifyEmailTransport } = require('./services/email');

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

app.use(helmet());

app.use(cors({
  origin: '*',
  methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.options('*', cors());

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX        || '200',   10),
  standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many requests, please slow down.' },
});
app.use('/api', limiter);

const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 30, message: { message: 'Too many auth attempts.' } });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// AI Chat endpoint (public — no auth required for chatting)
app.post('/api/ai/chat', require('./routes/aiChat'));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/prayers',   authenticate, prayerRoutes);
app.use('/api/journal',   authenticate, journalRoutes);
app.use('/api/goals',     authenticate, goalRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);
app.use('/api/onboarding', authenticate, onboardingRoutes);
app.use('/api/library',   authenticate, libraryRoutes);
app.use('/api/daily-verse', authenticate, dailyVerseRoutes);
app.use('/api/admin',     adminRoutes);

// 404
app.use((req, res) => res.status(404).json({ message: 'Route not found.' }));

// Global error handler
app.use((err, req, res, _next) => {
  const id = req && req.id ? req.id : 'no-id';
  console.error(`[ERROR][${id}]`, err.stack || err);
  const status = err.status || 500;
  res.status(status).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
    requestId: id,
  });
});

// Start server
(async () => {
  try {
    await prisma.$connect();
    console.log('✅ Prisma connected.');
  } catch (err) {
    console.error('[DB] Connect error:', err.message);
  }

  try {
    await verifyEmailTransport();
  } catch (err) {
    console.error('[EMAIL] Transport check failed:', err.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✝  ReviveSpring API on port ${PORT}`);
    console.log(`   Daily email job: runs every hour`);
  });

  // ── Daily Prayer Email Scheduler ────────────────────────────
  // Runs once on startup to catch any users missed, then every hour
  try { await runDailyPrayerEmailJob(); } catch (e) { console.error('[JOB] Startup run error:', e.message); }
  setInterval(async () => {
    try { await runDailyPrayerEmailJob(); }
    catch (e) { console.error('[JOB] Hourly run error:', e.message); }
  }, 60 * 60 * 1000);
})();

module.exports = app;
