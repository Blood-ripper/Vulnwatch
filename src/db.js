'use strict';

const { createClient } = require('@libsql/client');

// Turso / libSQL connection details come from the environment.
// TURSO_DATABASE_URL may be a remote Turso URL (libsql://...) or a local
// file URL (file:local.db) for development. TURSO_AUTH_TOKEN is required for
// remote Turso databases and ignored for local file URLs.
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error('TURSO_DATABASE_URL is not set. Define it in your .env file.');
}

// Integers are returned as JS numbers by default (intMode: 'number'), which
// keeps row shapes identical to the previous better-sqlite3 setup.
const db = createClient({ url, authToken });

// Create the schema if it doesn't exist. Turso uses the same SQL syntax as
// SQLite, so these statements are unchanged from the better-sqlite3 version.
// Add a column to a table only if it isn't already present. Used to upgrade
// databases created before the email-verification columns existed. Table and
// column names here are fixed literals (never user input), so interpolating
// them is safe.
// Returns true if the column was actually added, false if it already existed.
async function ensureColumn(table, column, definition) {
  try {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    return true;
  } catch (err) {
    if (/duplicate column name/i.test(err.message || '')) {
      return false;
    }
    throw err;
  }
}

async function init() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      email                TEXT NOT NULL UNIQUE,
      password_hash        TEXT NOT NULL,
      verified             INTEGER NOT NULL DEFAULT 0,
      verification_code    TEXT,
      verification_expires TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL,
      cve      TEXT NOT NULL,
      vendor   TEXT,
      note     TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_user_id ON watchlist(user_id);
  `);

  // Upgrade path for existing databases: add the verification columns if a
  // prior schema (without them) already created the users table.
  const addedVerified = await ensureColumn('users', 'verified', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('users', 'verification_code', 'TEXT');
  await ensureColumn('users', 'verification_expires', 'TEXT');

  // One-time grandfathering: when the `verified` column is first introduced on
  // a database that already has users, treat those pre-existing accounts as
  // verified so the new rule doesn't lock them out. This runs only on the
  // migration itself — on a fresh DB the column already exists (added false),
  // so genuinely-pending signups are never retroactively verified.
  if (addedVerified) {
    await db.execute('UPDATE users SET verified = 1');
  }
}

module.exports = { db, init };
