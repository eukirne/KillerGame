const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById } = require('../utils/helpers');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const cap = Math.min(Number(req.query.limit) || 30, 100);

  const expenseRows = db
    .prepare(
      `SELECT DISTINCT e.* FROM expenses e
       LEFT JOIN expense_shares es ON es.expense_id = e.id
       WHERE e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
       ORDER BY e.created_at DESC LIMIT ?`
    )
    .all(req.userId, req.userId, cap);

  const settlementRows = db
    .prepare('SELECT * FROM settlements WHERE from_user = ? OR to_user = ? ORDER BY created_at DESC LIMIT ?')
    .all(req.userId, req.userId, cap);

  const groupNameById = new Map();
  const getGroupName = (id) => {
    if (!id) return null;
    if (!groupNameById.has(id)) {
      const g = db.prepare('SELECT name FROM groups WHERE id = ?').get(id);
      groupNameById.set(id, g ? g.name : null);
    }
    return groupNameById.get(id);
  };

  const items = [
    ...expenseRows.map((e) => ({
      type: 'expense',
      id: e.id,
      groupId: e.group_id,
      groupName: getGroupName(e.group_id),
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      paidBy: publicUser(getUserById(e.paid_by)),
      createdAt: e.created_at,
    })),
    ...settlementRows.map((s) => ({
      type: 'settlement',
      id: s.id,
      groupId: s.group_id,
      groupName: getGroupName(s.group_id),
      amount: s.amount,
      currency: s.currency,
      from: publicUser(getUserById(s.from_user)),
      to: publicUser(getUserById(s.to_user)),
      createdAt: s.created_at,
    })),
  ];

  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ activity: items.slice(0, cap) });
});

module.exports = router;
