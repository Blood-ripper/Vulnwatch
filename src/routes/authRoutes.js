'use strict';

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const { db } = require('../db');
const { signToken } = require('../auth');
const { sendVerificationEmail } = require('../mailer');

const router = express.Router();

const BCRYPT_COST = 12;

// Verification code: 6 digits, valid for 15 minutes.
const CODE_TTL_MS = 15 * 60 * 1000;

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

// Rate limit verification attempts: 10 per 15 minutes per IP, so a 6-digit
// code can't be brute-forced. (Separate limiter — the login limiter above is
// unchanged.)
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Try again in 15 minutes.' },
});

// SQL statements — parametrized with positional `?` placeholders (no string
// concatenation). Turso/libSQL uses the same SQL syntax as SQLite.
const INSERT_USER =
  'INSERT INTO users (email, password_hash, verification_code, verification_expires) VALUES (?, ?, ?, ?)';
const FIND_USER_BY_EMAIL =
  'SELECT id, email, password_hash, verified, verification_code, verification_expires FROM users WHERE email = ?';
const DELETE_USER = 'DELETE FROM users WHERE id = ?';
const MARK_VERIFIED =
  'UPDATE users SET verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?';

function isUniqueViolation(err) {
  return (
    err &&
    (err.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      /UNIQUE constraint failed/i.test(err.message || ''))
  );
}

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function validateCredentials(body) {
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!EMAIL_RE.test(email)) {
    return { error: 'A valid email is required' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  return { email, password };
}

// Generate a zero-padded 6-digit code using a CSPRNG.
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Constant-time comparison of two short codes.
function codesMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// POST /auth/signup — creates an unverified account and emails a code.
// Does NOT log the user in; they must verify first.
router.post('/signup', async (req, res, next) => {
  try {
    const { error, email, password } = validateCredentials(req.body || {});
    if (error) {
      return res.status(400).json({ error });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const code = generateCode();
    const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();

    let result;
    try {
      result = await db.execute({
        sql: INSERT_USER,
        args: [email, passwordHash, code, expires],
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'Email is already registered' });
      }
      throw err;
    }

    // Send the code. If delivery fails, roll back the pending account so the
    // address is free to sign up again.
    try {
      await sendVerificationEmail(email, code);
    } catch (err) {
      await db.execute({ sql: DELETE_USER, args: [Number(result.lastInsertRowid)] });
      console.error('Failed to send verification email:', err);
      return res
        .status(502)
        .json({ error: 'Could not send verification email. Please try again.' });
    }

    return res.status(201).json({
      message:
        'Account created. Check your email for a 6-digit verification code, then POST it to /auth/verify to activate your account.',
      email,
    });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/verify — submit the emailed code to activate the account.
// Rate-limited. On success the account is verified and a JWT is returned.
router.post('/verify', verifyLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = normalizeEmail(body.email);
    const code = typeof body.code === 'string' ? body.code.trim() : '';

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'A 6-digit code is required' });
    }

    const result = await db.execute({ sql: FIND_USER_BY_EMAIL, args: [email] });
    const user = result.rows[0];

    if (user && user.verified) {
      return res.status(200).json({ message: 'Email already verified. You can log in.' });
    }

    const expired =
      !user ||
      !user.verification_expires ||
      Date.now() > Date.parse(user.verification_expires);

    // One generic error for every failure mode (unknown email, expired, or
    // wrong code) so the endpoint doesn't leak which accounts exist.
    if (expired || !codesMatch(code, user.verification_code || '')) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    await db.execute({ sql: MARK_VERIFIED, args: [Number(user.id)] });

    const token = signToken(Number(user.id));
    return res.json({ token });
  } catch (err) {
    return next(err);
  }
});

// POST /auth/login (rate-limited). Blocks login until the account is verified.
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

    if (!user.verified) {
      return res.status(403).json({
        error:
          'Email not verified. Check your email for the verification code and submit it to /auth/verify.',
      });
    }

    const token = signToken(Number(user.id));
    return res.json({ token });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
