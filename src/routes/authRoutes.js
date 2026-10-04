'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const db = require('../db');
const { signToken } = require('../auth');

const router = express.Router();

const BCRYPT_COST = 12;

// Basic email shape check — enough to reject obvious garbage without being strict.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rate limit login attempts: 5 per 15 minutes per IP, to blunt brute-force attacks.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Prepared statements (parametrized — no string concatenation of SQL).
const insertUser = db.prepare(
  'INSERT INTO users (email, password_hash) VALUES (?, ?)'
);
const findUserByEmail = db.prepare(
  'SELECT id, email, password_hash FROM users WHERE email = ?'
);

function validateCredentials(body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!EMAIL_RE.test(email)) {
    return { error: 'A valid email is required' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  return { email, password };
}

// POST /auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { error, email, password } = validateCredentials(req.body || {});
    if (error) {
      return res.status(400).json({ error });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    let result;
    try {
      result = insertUser.run(email, passwordHash);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: 'Email is already registered' });
      }
      throw err;
    }

    const token = signToken(result.lastInsertRowid);
    return res.status(201).json({ token });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/login (rate-limited)
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { error, email, password } = validateCredentials(req.body || {});
    if (error) {
      return res.status(400).json({ error });
    }

    const user = findUserByEmail.get(email);

    // Always run a bcrypt comparison to keep timing uniform whether or not
    // the user exists, then return the same generic error for any failure.
    const hash = user ? user.password_hash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user.id);
    return res.json({ token });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
