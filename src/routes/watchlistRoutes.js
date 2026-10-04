'use strict';

const express = require('express');

const db = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Every route in this router requires a valid JWT.
router.use(requireAuth);

// Prepared statements (parametrized — no string concatenation of SQL).
const listForUser = db.prepare(
  'SELECT id, cve, vendor, note, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC'
);
const insertItem = db.prepare(
  'INSERT INTO watchlist (user_id, cve, vendor, note) VALUES (?, ?, ?, ?)'
);
const getItem = db.prepare(
  'SELECT id, cve, vendor, note, added_at FROM watchlist WHERE id = ? AND user_id = ?'
);
const deleteItem = db.prepare(
  'DELETE FROM watchlist WHERE id = ? AND user_id = ?'
);

// GET /watchlist — the logged-in user's saved CVEs.
router.get('/', (req, res) => {
  const items = listForUser.all(req.userId);
  res.json({ items });
});

// POST /watchlist — add a CVE scoped to the logged-in user.
router.post('/', (req, res) => {
  const body = req.body || {};
  const cve = typeof body.cve === 'string' ? body.cve.trim() : '';
  const vendor = typeof body.vendor === 'string' ? body.vendor.trim() : null;
  const note = typeof body.note === 'string' ? body.note.trim() : null;

  if (!cve) {
    return res.status(400).json({ error: 'cve is required' });
  }

  const result = insertItem.run(req.userId, cve, vendor || null, note || null);
  const item = getItem.get(result.lastInsertRowid, req.userId);
  return res.status(201).json({ item });
});

// DELETE /watchlist/:id — delete only if it belongs to the logged-in user.
router.delete('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const result = deleteItem.run(id, req.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(204).end();
});

module.exports = router;
