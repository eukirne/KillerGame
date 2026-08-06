const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, getUsersByIds, ensureFriendship, isGroupMember, getGroupMemberIds } = require('../utils/helpers');
const { computeShares } = require('../utils/splitLogic');
const { fromCents } = require('../utils/money');
const fx = require('../utils/fx');
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

// Batched serializer: one query for every expense's shares, one for every
// user involved (payers/creators/share-holders across the whole list), and
// one fx.getRates call for every distinct currency/date pair — instead of
// that fan-out repeated per expense. Safe to call with a single-item array
// for the single-expense routes below.
async function serializeExpenses(rows, viewerCurrency) {
  if (rows.length === 0) return [];
  const ids = rows.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  const shareRows = await db.all(`SELECT expense_id, user_id, amount FROM expense_shares WHERE expense_id IN (${placeholders})`, ids);

  const sharesByExpense = new Map();
  for (const s of shareRows) {
    if (!sharesByExpense.has(s.expense_id)) sharesByExpense.set(s.expense_id, []);
    sharesByExpense.get(s.expense_id).push(s);
  }

  const userIds = new Set();
  for (const e of rows) {
    userIds.add(e.paid_by);
    userIds.add(e.created_by);
  }
  for (const s of shareRows) userIds.add(s.user_id);
  const userById = await getUsersByIds([...userIds]);

  let rates = new Map();
  if (viewerCurrency) {
    const pairs = rows.filter((e) => e.currency !== viewerCurrency).map((e) => ({ currency: e.currency, date: e.date }));
    if (pairs.length) rates = await fx.getRates(pairs, viewerCurrency);
  }

  return rows.map((e) => {
    const shares = (sharesByExpense.get(e.id) || []).map((s) => ({ user: publicUser(userById.get(s.user_id)), amount: s.amount }));

    let convertedAmount = null;
    let convertedCurrency = null;
    if (viewerCurrency && viewerCurrency !== e.currency) {
      const rate = rates.get(`${e.currency}|${e.date}`) ?? 1;
      convertedAmount = Math.round(e.amount * rate * 100) / 100;
      convertedCurrency = viewerCurrency;
    }

    return {
      id: e.id,
      groupId: e.group_id,
      description: e.description,
      amount: e.amount,
      currency: e.currency,
      convertedAmount,
      convertedCurrency,
      category: e.category,
      splitType: e.split_type,
      date: e.date,
      paidBy: publicUser(userById.get(e.paid_by)),
      createdBy: publicUser(userById.get(e.created_by)),
      createdAt: e.created_at,
      shares,
    };
  });
}

async function serializeExpense(e, viewerCurrency) {
  const [result] = await serializeExpenses([e], viewerCurrency);
  return result;
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

    const [expense, me] = await Promise.all([db.get('SELECT * FROM expenses WHERE id = ?', [expenseId]), getUserById(req.userId)]);
    res.status(201).json({ expense: await serializeExpense(expense, me.default_currency) });
  })
);

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { groupId, friendId, limit } = req.query;
    const cap = Math.min(Number(limit) || 50, 200);
    // Independent of whichever branch below runs — fetch it concurrently
    // instead of after.
    const mePromise = getUserById(req.userId);
    let rows;

    if (groupId) {
      const [isMember, groupRows] = await Promise.all([
        isGroupMember(Number(groupId), req.userId),
        db.all('SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY date DESC, id DESC LIMIT ?', [Number(groupId), cap]),
      ]);
      if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });
      rows = groupRows;
    } else if (friendId) {
      const friendIdNum = Number(friendId);
      rows = await db.all(
        `SELECT DISTINCT e.* FROM expenses e
         LEFT JOIN expense_shares es ON es.expense_id = e.id
         WHERE e.group_id IS NULL AND e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
         ORDER BY e.date DESC, e.id DESC LIMIT ?`,
        [req.userId, req.userId, cap]
      );
      // Narrow to expenses that include both the current user and the
      // friend — one batched query for every row's shares instead of the
      // two isExpenseParticipant() round trips per row this used to be.
      const rowIds = rows.map((e) => e.id);
      const shareUsersByExpense = new Map();
      if (rowIds.length) {
        const placeholders = rowIds.map(() => '?').join(',');
        const shareRows = await db.all(
          `SELECT expense_id, user_id FROM expense_shares WHERE expense_id IN (${placeholders}) AND user_id IN (?, ?)`,
          [...rowIds, req.userId, friendIdNum]
        );
        for (const s of shareRows) {
          if (!shareUsersByExpense.has(s.expense_id)) shareUsersByExpense.set(s.expense_id, new Set());
          shareUsersByExpense.get(s.expense_id).add(s.user_id);
        }
      }
      rows = rows.filter((e) => {
        const shareUsers = shareUsersByExpense.get(e.id);
        const meIn = e.paid_by === req.userId || (shareUsers && shareUsers.has(req.userId));
        const friendIn = e.paid_by === friendIdNum || (shareUsers && shareUsers.has(friendIdNum));
        return meIn && friendIn;
      });
    } else {
      rows = await db.all(
        `SELECT DISTINCT e.* FROM expenses e
         LEFT JOIN expense_shares es ON es.expense_id = e.id
         WHERE e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
         ORDER BY e.date DESC, e.id DESC LIMIT ?`,
        [req.userId, req.userId, cap]
      );
    }

    const me = await mePromise;
    res.json({ expenses: await serializeExpenses(rows, me.default_currency) });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const expense = await db.get('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!expense) return res.status(404).json({ error: 'Expense not found' });

    // Same trade as elsewhere: run the auth check alongside the data it
    // gates instead of after it, and eat a little wasted work on the rare
    // 403 path in exchange for far fewer round trips on every other one.
    const [isAuthorized, commentRows, me] = await Promise.all([
      expense.group_id ? isGroupMember(expense.group_id, req.userId) : isExpenseParticipant(expense.id, req.userId),
      db.all('SELECT * FROM comments WHERE expense_id = ? ORDER BY created_at ASC', [expense.id]),
      getUserById(req.userId),
    ]);
    if (!isAuthorized) return res.status(403).json({ error: 'Not authorized' });

    const [commentUserById, expenseOut] = await Promise.all([
      getUsersByIds(commentRows.map((c) => c.user_id)),
      serializeExpense(expense, me.default_currency),
    ]);
    const comments = commentRows.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      user: publicUser(commentUserById.get(c.user_id)),
    }));
    res.json({ expense: expenseOut, comments });
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

    const [updated, me] = await Promise.all([db.get('SELECT * FROM expenses WHERE id = ?', [expense.id]), getUserById(req.userId)]);
    res.json({ expense: await serializeExpense(updated, me.default_currency) });
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
    // RETURNING the columns we need means the insert alone gives us the
    // whole row — no follow-up SELECT round trip required.
    const [result, me] = await Promise.all([
      db.run('INSERT INTO comments (expense_id, user_id, body) VALUES (?, ?, ?) RETURNING id, created_at', [
        expense.id,
        req.userId,
        body.trim(),
      ]),
      getUserById(req.userId),
    ]);
    const comment = result.rows[0];
    res.status(201).json({
      comment: { id: comment.id, body: body.trim(), createdAt: comment.created_at, user: publicUser(me) },
    });
  })
);

module.exports = router;
