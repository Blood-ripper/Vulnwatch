'use strict';

const express = require('express');

const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Every route in this router requires a valid JWT.
router.use(requireAuth);

// SQL statements — parametrized with positional `?` placeholders (no string
// concatenation). Turso/libSQL uses the same SQL syntax as SQLite.
const LIST_FOR_USER =
  'SELECT id, cve, vendor, note, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC';
const INSERT_ITEM =
  'INSERT INTO watchlist (user_id, cve, vendor, note) VALUES (?, ?, ?, ?)';
const GET_ITEM =
  'SELECT id, cve, vendor, note, added_at FROM watchlist WHERE id = ? AND user_id = ?';
const DELETE_ITEM = 'DELETE FROM watchlist WHERE id = ? AND user_id = ?';

// Normalize a libSQL row to a plain object so the JSON response shape stays
// identical to the previous better-sqlite3 implementation.
function toItem(row) {
  return {
    id: row.id,
    cve: row.cve,
    vendor: row.vendor,
    note: row.note,
    added_at: row.added_at,
  };
}

// GET /watchlist — the logged-in user's saved CVEs.
router.get('/', async (req, res, next) => {
  try {
    const result = await db.execute({ sql: LIST_FOR_USER, args: [req.userId] });
    return res.json({ items: result.rows.map(toItem) });
  } catch (err) {
    return next(err);
  }
});

// POST /watchlist — add a CVE scoped to the logged-in user.
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const cve = typeof body.cve === 'string' ? body.cve.trim() : '';
    const vendor = typeof body.vendor === 'string' ? body.vendor.trim() : null;
    const note = typeof body.note === 'string' ? body.note.trim() : null;

    if (!cve) {
      return res.status(400).json({ error: 'cve is required' });
    }

    const result = await db.execute({
      sql: INSERT_ITEM,
      args: [req.userId, cve, vendor || null, note || null],
    });
    const got = await db.execute({
      sql: GET_ITEM,
      args: [Number(result.lastInsertRowid), req.userId],
    });
    return res.status(201).json({ item: toItem(got.rows[0]) });
  } catch (err) {
    return next(err);
  }
});

// DELETE /watchlist/:id — delete only if it belongs to the logged-in user.
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const result = await db.execute({ sql: DELETE_ITEM, args: [id, req.userId] });
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
