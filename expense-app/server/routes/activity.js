const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById } = require('../utils/helpers');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cap = Math.min(Number(req.query.limit) || 30, 100);

    const expenseRows = await db.all(
      `SELECT DISTINCT e.* FROM expenses e
       LEFT JOIN expense_shares es ON es.expense_id = e.id
       WHERE e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
       ORDER BY e.created_at DESC LIMIT ?`,
      [req.userId, req.userId, cap]
    );

    const settlementRows = await db.all('SELECT * FROM settlements WHERE from_user = ? OR to_user = ? ORDER BY created_at DESC LIMIT ?', [
      req.userId,
      req.userId,
      cap,
    ]);

    const groupNameById = new Map();
    async function getGroupName(id) {
      if (!id) return null;
      if (!groupNameById.has(id)) {
        const g = await db.get('SELECT name FROM groups WHERE id = ?', [id]);
        groupNameById.set(id, g ? g.name : null);
      }
      return groupNameById.get(id);
    }

    const expenseItems = await Promise.all(
      expenseRows.map(async (e) => ({
        type: 'expense',
        id: e.id,
        groupId: e.group_id,
        groupName: await getGroupName(e.group_id),
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        paidBy: publicUser(await getUserById(e.paid_by)),
        createdAt: e.created_at,
      }))
    );

    const settlementItems = await Promise.all(
      settlementRows.map(async (s) => ({
        type: 'settlement',
        id: s.id,
        groupId: s.group_id,
        groupName: await getGroupName(s.group_id),
        amount: s.amount,
        currency: s.currency,
        from: publicUser(await getUserById(s.from_user)),
        to: publicUser(await getUserById(s.to_user)),
        createdAt: s.created_at,
      }))
    );

    const items = [...expenseItems, ...settlementItems];
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ activity: items.slice(0, cap) });
  })
);

module.exports = router;
