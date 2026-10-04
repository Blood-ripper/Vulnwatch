'use strict';

const nodemailer = require('nodemailer');

// Gmail SMTP credentials come from the environment. GMAIL_APP_PASSWORD must be
// a Google "App Password" (16 chars), not the account's normal password — see
// the README for how to generate one.
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

let transporter;

// Lazily create the transporter so the module can be imported (and buildMessage
// unit-tested) without opening an SMTP connection.
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

// Build the verification email. Pure function — no side effects — so it's easy
// to test.
function buildMessage(to, code) {
  return {
    from: `watchlist-api <${GMAIL_USER}>`,
    to,
    subject: 'Your watchlist-api verification code',
    text:
      `Your watchlist-api verification code is ${code}.\n\n` +
      'It expires in 15 minutes. If you did not create an account, you can ignore this email.',
    html:
      `<p>Your watchlist-api verification code is <strong style="font-size:1.2em">${code}</strong>.</p>` +
      '<p>It expires in 15 minutes. If you did not create an account, you can ignore this email.</p>',
  };
}

// Send the 6-digit verification code to the given address. Rejects if SMTP
// delivery fails, so callers can react (e.g. roll back the pending signup).
async function sendVerificationEmail(to, code) {
  return getTransporter().sendMail(buildMessage(to, code));
}

module.exports = { sendVerificationEmail, buildMessage };
