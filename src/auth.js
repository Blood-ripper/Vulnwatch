'use strict';

const jwt = require('jsonwebtoken');

const TOKEN_EXPIRY = '7d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail loudly rather than signing tokens with an empty/undefined secret.
    throw new Error('JWT_SECRET is not set. Define it in your .env file.');
  }
  return secret;
}

// Create a signed JWT carrying the user id as the subject.
function signToken(userId) {
  return jwt.sign({ sub: userId }, getSecret(), { expiresIn: TOKEN_EXPIRY });
}

// Express middleware: require a valid "Authorization: Bearer <token>" header,
// and attach the authenticated user id to req.userId.
function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  try {
    const payload = jwt.verify(token, getSecret());
    req.userId = payload.sub;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { signToken, requireAuth, TOKEN_EXPIRY };
