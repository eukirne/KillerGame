const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, getUsersByIds } = require('../utils/helpers');
const fx = require('../utils/fx');
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

    const groupIds = [...new Set([...expenseRows, ...settlementRows].map((r) => r.group_id).filter(Boolean))];
    const groupNameById = new Map();
    if (groupIds.length) {
      const placeholders = groupIds.map(() => '?').join(',');
      const groupRows = await db.all(`SELECT id, name FROM groups WHERE id IN (${placeholders})`, groupIds);
      for (const g of groupRows) groupNameById.set(g.id, g.name);
    }

    const me = await getUserById(req.userId);
    const myCurrency = me.default_currency;

    const userIds = [
      ...expenseRows.map((e) => e.paid_by),
      ...settlementRows.map((s) => s.from_user),
      ...settlementRows.map((s) => s.to_user),
    ];
    const userById = await getUsersByIds(userIds);

    let rates = new Map();
    if (myCurrency) {
      const pairs = expenseRows.filter((e) => e.currency !== myCurrency).map((e) => ({ currency: e.currency, date: e.date }));
      if (pairs.length) rates = await fx.getRates(pairs, myCurrency);
    }

    const expenseItems = expenseRows.map((e) => {
      let convertedAmount = null;
      let convertedCurrency = null;
      if (myCurrency && myCurrency !== e.currency) {
        const rate = rates.get(`${e.currency}|${e.date}`) ?? 1;
        convertedAmount = Math.round(e.amount * rate * 100) / 100;
        convertedCurrency = myCurrency;
      }
      return {
        type: 'expense',
        id: e.id,
        groupId: e.group_id,
        groupName: groupNameById.get(e.group_id) || null,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        convertedAmount,
        convertedCurrency,
        paidBy: publicUser(userById.get(e.paid_by)),
        createdAt: e.created_at,
      };
    });

    const settlementItems = settlementRows.map((s) => ({
      type: 'settlement',
      id: s.id,
      groupId: s.group_id,
      groupName: groupNameById.get(s.group_id) || null,
      amount: s.amount,
      currency: s.currency,
      from: publicUser(userById.get(s.from_user)),
      to: publicUser(userById.get(s.to_user)),
      createdAt: s.created_at,
    }));

    const items = [...expenseItems, ...settlementItems];
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ activity: items.slice(0, cap) });
  })
);

module.exports = router;
