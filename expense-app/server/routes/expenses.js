const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, ensureFriendship, isGroupMember, getGroupMemberIds } = require('../utils/helpers');
const { computeShares } = require('../utils/splitLogic');
const { fromCents } = require('../utils/money');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

async function isExpenseParticipant(expenseId, userId) {
  const row = await db.get(
    `SELECT 1 FROM expenses e
       LEFT JOIN expense_shares es ON es.expense_id = e.id AND es.user_id = ?
       WHERE e.id = ? AND (e.paid_by = ? OR es.user_id IS NOT NULL)`,
    [userId, expenseId, userId]
  );
  return !!row;
}

async function serializeExpense(e) {
  const shareRows = await db.all('SELECT user_id, amount FROM expense_shares WHERE expense_id = ?', [e.id]);
  const shares = await Promise.all(
    shareRows.map(async (s) => ({ user: publicUser(await getUserById(s.user_id)), amount: s.amount }))
  );
  const [paidBy, createdBy] = await Promise.all([getUserById(e.paid_by), getUserById(e.created_by)]);
  return {
    id: e.id,
    groupId: e.group_id,
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    category: e.category,
    splitType: e.split_type,
    date: e.date,
    paidBy: publicUser(paidBy),
    createdBy: publicUser(createdBy),
    createdAt: e.created_at,
    shares,
  };
}

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { groupId, description, amount, currency, category, date, paidBy, splitType, participants } = req.body || {};

    const amountNum = Number(amount);
    if (!(amountNum > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
    const payerId = Number(paidBy) || req.userId;

    let members = null;
    if (groupId) {
      const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (!(await isGroupMember(groupId, req.userId))) return res.status(403).json({ error: 'Not a member of this group' });
      members = new Set(await getGroupMemberIds(groupId));
      if (!members.has(payerId)) return res.status(400).json({ error: 'Payer must be a member of the group' });
    }

    let shares;
    try {
      shares = computeShares(splitType || 'equal', amountNum, participants);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (shares.length === 0) return res.status(400).json({ error: 'At least one participant is required' });
    if (members) {
      for (const s of shares) {
        if (!members.has(s.userId)) return res.status(400).json({ error: 'All participants must be members of the group' });
      }
    }
    if (!groupId && !shares.some((s) => s.userId === req.userId) && payerId !== req.userId) {
      return res.status(400).json({ error: 'You must be involved in this expense' });
    }

    const expenseId = await db.transaction(async (tx) => {
      const result = await tx.run(
        `INSERT INTO expenses (group_id, description, amount, currency, category, paid_by, split_type, date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [
          groupId || null,
          description && description.trim() ? description.trim() : 'Expense',
          amountNum,
          currency || 'USD',
          category || 'general',
          payerId,
          splitType || 'equal',
          date || new Date().toISOString().slice(0, 10),
          req.userId,
        ]
      );
      const expenseId = result.rows[0].id;
      for (const s of shares) {
        await tx.run('INSERT INTO expense_shares (expense_id, user_id, amount) VALUES (?, ?, ?)', [
          expenseId,
          s.userId,
          fromCents(s.amountCents),
        ]);
      }
      if (!groupId) {
        const involved = new Set([payerId, ...shares.map((s) => s.userId)]);
        const ids = [...involved];
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) await ensureFriendship(ids[i], ids[j], tx);
        }
      }
      return expenseId;
    });

    const expense = await db.get('SELECT * FROM expenses WHERE id = ?', [expenseId]);
    res.status(201).json({ expense: await serializeExpense(expense) });
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
      rows = await db.all('SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY date DESC, id DESC LIMIT ?', [
        Number(groupId),
        cap,
      ]);
    } else if (friendId) {
      rows = await db.all(
        `SELECT DISTINCT e.* FROM expenses e
         LEFT JOIN expense_shares es ON es.expense_id = e.id
         WHERE e.group_id IS NULL AND e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
         ORDER BY e.date DESC, e.id DESC LIMIT ?`,
        [req.userId, req.userId, cap]
      );
      // narrow to expenses that include both the current user and the friend
      const flags = await Promise.all(
        rows.map(async (e) => (await isExpenseParticipant(e.id, req.userId)) && (await isExpenseParticipant(e.id, Number(friendId))))
      );
      rows = rows.filter((_, i) => flags[i]);
    } else {
      rows = await db.all(
        `SELECT DISTINCT e.* FROM expenses e
         LEFT JOIN expense_shares es ON es.expense_id = e.id
         WHERE e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
         ORDER BY e.date DESC, e.id DESC LIMIT ?`,
        [req.userId, req.userId, cap]
      );
    }

    res.json({ expenses: await Promise.all(rows.map(serializeExpense)) });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.group_id) {
      if (!(await isGroupMember(expense.group_id, req.userId))) return res.status(403).json({ error: 'Not authorized' });
    } else if (!(await isExpenseParticipant(expense.id, req.userId))) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const commentRows = await db.all('SELECT * FROM comments WHERE expense_id = ? ORDER BY created_at ASC', [expense.id]);
    const comments = await Promise.all(
      commentRows.map(async (c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        user: publicUser(await getUserById(c.user_id)),
      }))
    );
    res.json({ expense: await serializeExpense(expense), comments });
  })
);

router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (!(await isExpenseParticipant(expense.id, req.userId)) && expense.paid_by !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { description, amount, currency, category, date, paidBy, splitType, participants } = req.body || {};
    const amountNum = amount !== undefined ? Number(amount) : expense.amount;
    const payerId = paidBy !== undefined ? Number(paidBy) : expense.paid_by;
    const finalSplitType = splitType || expense.split_type;

    let members = null;
    if (expense.group_id) {
      members = new Set(await getGroupMemberIds(expense.group_id));
      if (!members.has(payerId)) return res.status(400).json({ error: 'Payer must be a member of the group' });
    }

    let shares;
    try {
      if (participants) {
        shares = computeShares(finalSplitType, amountNum, participants);
      } else {
        const existing = await db.all('SELECT user_id AS "userId", amount FROM expense_shares WHERE expense_id = ?', [expense.id]);
        shares = existing.map((s) => ({ userId: s.userId, amountCents: Math.round(s.amount * 100) }));
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (members) {
      for (const s of shares) {
        if (!members.has(s.userId)) return res.status(400).json({ error: 'All participants must be members of the group' });
      }
    }

    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE expenses SET description = ?, amount = ?, currency = ?, category = ?, paid_by = ?, split_type = ?, date = ?
       WHERE id = ?`,
        [
          description && description.trim() ? description.trim() : expense.description,
          amountNum,
          currency || expense.currency,
          category || expense.category,
          payerId,
          finalSplitType,
          date || expense.date,
          expense.id,
        ]
      );
      if (participants) {
        await tx.run('DELETE FROM expense_shares WHERE expense_id = ?', [expense.id]);
        for (const s of shares) {
          await tx.run('INSERT INTO expense_shares (expense_id, user_id, amount) VALUES (?, ?, ?)', [
            expense.id,
            s.userId,
            fromCents(s.amountCents),
          ]);
        }
      }
    });

    const updated = await db.get('SELECT * FROM expenses WHERE id = ?', [expense.id]);
    res.json({ expense: await serializeExpense(updated) });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (!(await isExpenseParticipant(expense.id, req.userId)) && expense.paid_by !== req.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await db.run('UPDATE expenses SET deleted = 1 WHERE id = ?', [expense.id]);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/comments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.group_id) {
      if (!(await isGroupMember(expense.group_id, req.userId))) return res.status(403).json({ error: 'Not authorized' });
    } else if (!(await isExpenseParticipant(expense.id, req.userId))) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
    const result = await db.run('INSERT INTO comments (expense_id, user_id, body) VALUES (?, ?, ?) RETURNING id', [
      expense.id,
      req.userId,
      body.trim(),
    ]);
    const comment = await db.get('SELECT * FROM comments WHERE id = ?', [result.rows[0].id]);
    res.status(201).json({
      comment: { id: comment.id, body: comment.body, createdAt: comment.created_at, user: publicUser(await getUserById(req.userId)) },
    });
  })
);

module.exports = router;
