'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Fail fast on missing required config, before requiring modules that use it.
if (!process.env.JWT_SECRET) {
  console.error('Fatal: JWT_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}
if (!process.env.TURSO_DATABASE_URL) {
  console.error('Fatal: TURSO_DATABASE_URL is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}
if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
  console.error(
    'Fatal: GMAIL_USER and GMAIL_APP_PASSWORD must be set (used to email verification codes). See .env.example.'
  );
  process.exit(1);
}

const { init } = require('./db');
const authRoutes = require('./routes/authRoutes');
const watchlistRoutes = require('./routes/watchlistRoutes');

const app = express();

// Trust the first proxy hop so express-rate-limit sees the real client IP
// when deployed behind a reverse proxy / load balancer.
app.set('trust proxy', 1);

// Restrict browser access to the configured frontend origin.
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  })
);

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/watchlist', watchlistRoutes);

// 404 fallback.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// Only start listening when run directly (keeps the app importable for tests).
if (require.main === module) {
  init()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`watchlist-api listening on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}

module.exports = app;
