'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const { db } = require('../db');
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

// SQL statements — parametrized with positional `?` placeholders (no string
// concatenation). Turso/libSQL uses the same SQL syntax as SQLite.
const INSERT_USER = 'INSERT INTO users (email, password_hash) VALUES (?, ?)';
const FIND_USER_BY_EMAIL = 'SELECT id, email, password_hash FROM users WHERE email = ?';

function isUniqueViolation(err) {
  return (
    err &&
    (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      /UNIQUE constraint failed/i.test(err.message || ''))
  );
}

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
      result = await db.execute({ sql: INSERT_USER, args: [email, passwordHash] });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'Email is already registered' });
      }
      throw err;
    }

    const token = signToken(Number(result.lastInsertRowid));
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

    const result = await db.execute({ sql: FIND_USER_BY_EMAIL, args: [email] });
    const user = result.rows[0];

    // Always run a bcrypt comparison to keep timing uniform whether or not
    // the user exists, then return the same generic error for any failure.
    const hash = user ? user.password_hash : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(Number(user.id));
    return res.json({ token });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
