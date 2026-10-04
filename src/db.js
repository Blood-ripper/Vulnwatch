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
async function init() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
}

module.exports = { db, init };
