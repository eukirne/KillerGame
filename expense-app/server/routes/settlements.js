const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, getUsersByIds, isGroupMember } = require('../utils/helpers');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function formatSettlement(s, userById) {
  return {
    id: s.id,
    groupId: s.group_id,
    from: publicUser(userById.get(s.from_user)),
    to: publicUser(userById.get(s.to_user)),
    amount: s.amount,
    currency: s.currency,
    note: s.note,
    date: s.date,
    createdAt: s.created_at,
  };
}

async function serialize(s) {
  const userById = await getUsersByIds([s.from_user, s.to_user]);
  return formatSettlement(s, userById);
}

async function serializeAll(rows) {
  if (rows.length === 0) return [];
  const userById = await getUsersByIds(rows.flatMap((s) => [s.from_user, s.to_user]));
  return rows.map((s) => formatSettlement(s, userById));
}

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { groupId, toUser, fromUser, amount, currency, note, date } = req.body || {};
    const from = Number(fromUser) || req.userId;
    const to = Number(toUser);
    const amountNum = Number(amount);

    if (!to || to === from) return res.status(400).json({ error: 'A valid recipient is required' });
    if (!(amountNum > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
    if (from !== req.userId && to !== req.userId) return res.status(403).json({ error: 'You must be part of this settlement' });
    if (groupId && !(await isGroupMember(Number(groupId), req.userId))) {
      return res.status(403).json({ error: 'Not a member of this group' });
    }
    if (!(await getUserById(to))) return res.status(404).json({ error: 'Recipient not found' });

    const result = await db.run(
      `INSERT INTO settlements (group_id, from_user, to_user, amount, currency, note, date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [groupId || null, from, to, amountNum, currency || 'USD', note || null, date || new Date().toISOString().slice(0, 10), req.userId]
    );

    const settlement = await db.get('SELECT * FROM settlements WHERE id = ?', [result.rows[0].id]);
    res.status(201).json({ settlement: await serialize(settlement) });
  })
);

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { groupId, friendId, limit } = req.query;
    const cap = Math.min(Number(limit) || 50, 200);
    let rows;

    if (groupId) {
      if (!(await isGroupMember(Number(groupId), req.userId))) return res.status(403).json({ error: 'Not a member of this group' });
      rows = await db.all('SELECT * FROM settlements WHERE group_id = ? ORDER BY date DESC, id DESC LIMIT ?', [Number(groupId), cap]);
    } else if (friendId) {
      rows = await db.all(
        `SELECT * FROM settlements
         WHERE ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))
         ORDER BY date DESC, id DESC LIMIT ?`,
        [req.userId, Number(friendId), Number(friendId), req.userId, cap]
      );
    } else {
      rows = await db.all('SELECT * FROM settlements WHERE from_user = ? OR to_user = ? ORDER BY date DESC, id DESC LIMIT ?', [
        req.userId,
        req.userId,
        cap,
      ]);
    }

    res.json({ settlements: await serializeAll(rows) });
  })
);

module.exports = router;
