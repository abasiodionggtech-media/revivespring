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
const notificationRoutes = require('./routes/notifications');
const monetizationRoutes = require('./routes/monetization');
const supportRoutes   = require('./routes/support');
const moodCheckInRoutes = require('./routes/moodCheckIn');
const dailyMannaRoutes  = require('./routes/dailyManna');
const declarationsRoutes = require('./routes/declarations');
const { authenticate }      = require('./middleware/auth');
const { authenticateAdmin } = require('./middleware/adminAuth');
const prisma = require('./config/prisma');
const { runDailyPrayerEmailJob } = require('./jobs/dailyPrayerEmail');
const { runStreakGraceCheckJob } = require('./jobs/streakGraceCheck');
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

// AI endpoints (chat + conversation history)
app.use('/api/ai', require('./routes/aiChat'));

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
app.use('/api/notifications', authenticate, notificationRoutes);
app.use('/api/monetization', monetizationRoutes);
app.use('/api/support',   authenticate, supportRoutes);
app.use('/api/mood-checkin', authenticate, moodCheckInRoutes);
app.use('/api/daily-manna',  authenticate, dailyMannaRoutes);
app.use('/api/declarations', authenticate, declarationsRoutes);
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
    console.log(`   Daily email job: runs every minute`);
  });

  // ── Daily Prayer Email Scheduler ────────────────────────────
  // Runs once on startup, then every minute for exact reminder-time matching
  try { await runDailyPrayerEmailJob(); } catch (e) { console.error('[JOB] Startup run error:', e.message); }
  setInterval(async () => {
    try { await runDailyPrayerEmailJob(); }
    catch (e) { console.error('[JOB] Minute run error:', e.message); }
  }, 60 * 1000);

  // ── Prayer Streak Grace-Period Check ────────────────────────
  try { await runStreakGraceCheckJob(); } catch (e) { console.error('[JOB] Streak grace startup error:', e.message); }
  setInterval(async () => {
    try { await runStreakGraceCheckJob(); }
    catch (e) { console.error('[JOB] Streak grace hourly error:', e.message); }
  }, 60 * 60 * 1000);
})();

module.exports = app;
