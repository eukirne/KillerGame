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

    // Wave 1: none of these three depend on each other.
    const [expenseRows, settlementRows, me] = await Promise.all([
      db.all(
        `SELECT DISTINCT e.* FROM expenses e
       LEFT JOIN expense_shares es ON es.expense_id = e.id
       WHERE e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
       ORDER BY e.created_at DESC LIMIT ?`,
        [req.userId, req.userId, cap]
      ),
      db.all('SELECT * FROM settlements WHERE from_user = ? OR to_user = ? ORDER BY created_at DESC LIMIT ?', [
        req.userId,
        req.userId,
        cap,
      ]),
      getUserById(req.userId),
    ]);
    const myCurrency = me.default_currency;

    // Wave 2: group names, users, and fx rates are each derived purely from
    // wave 1's rows — independent of one another, so run them together too.
    const groupIds = [...new Set([...expenseRows, ...settlementRows].map((r) => r.group_id).filter(Boolean))];
    const userIds = [
      ...expenseRows.map((e) => e.paid_by),
      ...settlementRows.map((s) => s.from_user),
      ...settlementRows.map((s) => s.to_user),
    ];
    const ratePairs = myCurrency ? expenseRows.filter((e) => e.currency !== myCurrency).map((e) => ({ currency: e.currency, date: e.date })) : [];

    const [groupRows, userById, rates] = await Promise.all([
      groupIds.length ? db.all(`SELECT id, name FROM groups WHERE id IN (${groupIds.map(() => '?').join(',')})`, groupIds) : [],
      getUsersByIds(userIds),
      ratePairs.length ? fx.getRates(ratePairs, myCurrency) : new Map(),
    ]);
    const groupNameById = new Map(groupRows.map((g) => [g.id, g.name]));

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
