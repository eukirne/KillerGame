const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, isGroupMember } = require('../utils/helpers');

const router = express.Router();

function serialize(s) {
  return {
    id: s.id,
    groupId: s.group_id,
    from: publicUser(getUserById(s.from_user)),
    to: publicUser(getUserById(s.to_user)),
    amount: s.amount,
    currency: s.currency,
    note: s.note,
    date: s.date,
    createdAt: s.created_at,
  };
}

router.post('/', requireAuth, (req, res) => {
  const { groupId, toUser, fromUser, amount, currency, note, date } = req.body || {};
  const from = Number(fromUser) || req.userId;
  const to = Number(toUser);
  const amountNum = Number(amount);

  if (!to || to === from) return res.status(400).json({ error: 'A valid recipient is required' });
  if (!(amountNum > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
  if (from !== req.userId && to !== req.userId) return res.status(403).json({ error: 'You must be part of this settlement' });
  if (groupId && !isGroupMember(Number(groupId), req.userId)) return res.status(403).json({ error: 'Not a member of this group' });
  if (!getUserById(to)) return res.status(404).json({ error: 'Recipient not found' });

  const info = db
    .prepare(
      `INSERT INTO settlements (group_id, from_user, to_user, amount, currency, note, date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(groupId || null, from, to, amountNum, currency || 'USD', note || null, date || new Date().toISOString().slice(0, 10), req.userId);

  const settlement = db.prepare('SELECT * FROM settlements WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ settlement: serialize(settlement) });
});

router.get('/', requireAuth, (req, res) => {
  const { groupId, friendId, limit } = req.query;
  const cap = Math.min(Number(limit) || 50, 200);
  let rows;

  if (groupId) {
    if (!isGroupMember(Number(groupId), req.userId)) return res.status(403).json({ error: 'Not a member of this group' });
    rows = db.prepare('SELECT * FROM settlements WHERE group_id = ? ORDER BY date DESC, id DESC LIMIT ?').all(Number(groupId), cap);
  } else if (friendId) {
    rows = db
      .prepare(
        `SELECT * FROM settlements
         WHERE ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))
         ORDER BY date DESC, id DESC LIMIT ?`
      )
      .all(req.userId, Number(friendId), Number(friendId), req.userId, cap);
  } else {
    rows = db
      .prepare('SELECT * FROM settlements WHERE from_user = ? OR to_user = ? ORDER BY date DESC, id DESC LIMIT ?')
      .all(req.userId, req.userId, cap);
  }

  res.json({ settlements: rows.map(serialize) });
});

module.exports = router;
