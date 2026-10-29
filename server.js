// PortfolioX server: serves the frontend and the REST API.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { openDb, queryOne } = require('./utils/db');
const { requireAuth } = require('./middleware/auth');
const { notFoundApi, errorHandler } = require('./middleware/errors');
const { ok } = require('./utils/respond');
const C = require('./utils/constants');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');

app.disable('x-powered-by');
if (isProd) app.set('trust proxy', 1);

app.use(helmet({
  hsts: isProd,
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.use(express.json({ limit: '100kb' }));

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: { message: 'Too many requests. Please slow down.' } },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 100, skipSuccessfulRequests: true,
  standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: { message: 'Too many failed requests. Please wait a few minutes and try again.' } },
});

app.use('/api', generalLimiter);
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ---- Public API ----
app.get('/api/health', (req, res) => {
  let database = 'connected';
  try { queryOne('SELECT 1 AS x'); } catch (e) { database = 'error: ' + e.message; }
  res.status(database === 'connected' ? 200 : 503).json({
    ok: database === 'connected',
    status: database === 'connected' ? 'ok' : 'degraded',
    database, time: new Date().toISOString(),
  });
});

app.get('/api/config', (req, res) => ok(res, {
  projectCategories: C.PROJECT_CATEGORIES,
  achievementCategories: C.ACHIEVEMENT_CATEGORIES,
}));

// ---- Auth routes (signup / login) ----
app.use('/api/auth', authLimiter, require('./routes/auth'));

// ---- Private API routes ----
app.use('/api', require('./routes/portfolio')(authLimiter));
app.use('/api', require('./routes/readiness')(authLimiter));
app.use('/api/profile',      authLimiter, requireAuth, require('./routes/profile'));
app.use('/api/projects',     authLimiter, requireAuth, require('./routes/projects'));
app.use('/api/achievements', authLimiter, requireAuth, require('./routes/achievements'));
app.use('/api/resume',       authLimiter, requireAuth, require('./routes/resume'));
app.use('/api', notFoundApi);

// ---- Frontend ----
app.use(express.static(FRONTEND_DIR));
app.get('/u/:username', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'portfolio.html')));
app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND_DIR, '404.html')));
app.use(errorHandler);

// ---- Start ----
openDb().then(() => {
  app.listen(PORT, () => {
    console.log(`PortfolioX is running at http://localhost:${PORT}`);
    console.log(`Health check:        http://localhost:${PORT}/api/health`);
  });
}).catch((err) => {
  console.error('Failed to open database:', err.message);
  process.exit(1);
});
