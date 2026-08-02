const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, ensureFriendship, isGroupMember, getGroupMemberIds } = require('../utils/helpers');
const { computeShares } = require('../utils/splitLogic');
const { fromCents } = require('../utils/money');

const router = express.Router();

function isExpenseParticipant(expenseId, userId) {
  return !!db
    .prepare(
      `SELECT 1 FROM expenses e
       LEFT JOIN expense_shares es ON es.expense_id = e.id AND es.user_id = ?
       WHERE e.id = ? AND (e.paid_by = ? OR es.user_id IS NOT NULL)`
    )
    .get(userId, expenseId, userId);
}

function serializeExpense(e) {
  const shares = db
    .prepare('SELECT user_id, amount FROM expense_shares WHERE expense_id = ?')
    .all(e.id)
    .map((s) => ({ user: publicUser(getUserById(s.user_id)), amount: s.amount }));
  return {
    id: e.id,
    groupId: e.group_id,
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    category: e.category,
    splitType: e.split_type,
    date: e.date,
    paidBy: publicUser(getUserById(e.paid_by)),
    createdBy: publicUser(getUserById(e.created_by)),
    createdAt: e.created_at,
    shares,
  };
}

router.post('/', requireAuth, (req, res) => {
  const { groupId, description, amount, currency, category, date, paidBy, splitType, participants } = req.body || {};

  if (!description || !description.trim()) return res.status(400).json({ error: 'Description is required' });
  const amountNum = Number(amount);
  if (!(amountNum > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
  const payerId = Number(paidBy) || req.userId;

  let members = null;
  if (groupId) {
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(groupId, req.userId)) return res.status(403).json({ error: 'Not a member of this group' });
    members = new Set(getGroupMemberIds(groupId));
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

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO expenses (group_id, description, amount, currency, category, paid_by, split_type, date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        groupId || null,
        description.trim(),
        amountNum,
        currency || 'USD',
        category || 'general',
        payerId,
        splitType || 'equal',
        date || new Date().toISOString().slice(0, 10),
        req.userId
      );
    const expenseId = info.lastInsertRowid;
    const insertShare = db.prepare('INSERT INTO expense_shares (expense_id, user_id, amount) VALUES (?, ?, ?)');
    for (const s of shares) {
      insertShare.run(expenseId, s.userId, fromCents(s.amountCents));
    }
    if (!groupId) {
      const involved = new Set([payerId, ...shares.map((s) => s.userId)]);
      const ids = [...involved];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) ensureFriendship(ids[i], ids[j]);
      }
    }
    return expenseId;
  });

  const expenseId = tx();
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId);
  res.status(201).json({ expense: serializeExpense(expense) });
});

router.get('/', requireAuth, (req, res) => {
  const { groupId, friendId, limit } = req.query;
  const cap = Math.min(Number(limit) || 50, 200);
  let rows;

  if (groupId) {
    if (!isGroupMember(Number(groupId), req.userId)) return res.status(403).json({ error: 'Not a member of this group' });
    rows = db
      .prepare('SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY date DESC, id DESC LIMIT ?')
      .all(Number(groupId), cap);
  } else if (friendId) {
    rows = db
      .prepare(
        `SELECT DISTINCT e.* FROM expenses e
         LEFT JOIN expense_shares es ON es.expense_id = e.id
         WHERE e.group_id IS NULL AND e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
         ORDER BY e.date DESC, e.id DESC LIMIT ?`
      )
      .all(req.userId, req.userId, cap);
    // narrow to expenses that include both the current user and the friend
    rows = rows.filter((e) => isExpenseParticipant(e.id, req.userId) && isExpenseParticipant(e.id, Number(friendId)));
  } else {
    rows = db
      .prepare(
        `SELECT DISTINCT e.* FROM expenses e
         LEFT JOIN expense_shares es ON es.expense_id = e.id
         WHERE e.deleted = 0 AND (e.paid_by = ? OR es.user_id = ?)
         ORDER BY e.date DESC, e.id DESC LIMIT ?`
      )
      .all(req.userId, req.userId, cap);
  }

  res.json({ expenses: rows.map(serializeExpense) });
});

router.get('/:id', requireAuth, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  if (expense.group_id) {
    if (!isGroupMember(expense.group_id, req.userId)) return res.status(403).json({ error: 'Not authorized' });
  } else if (!isExpenseParticipant(expense.id, req.userId)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const comments = db
    .prepare('SELECT * FROM comments WHERE expense_id = ? ORDER BY created_at ASC')
    .all(expense.id)
    .map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, user: publicUser(getUserById(c.user_id)) }));
  res.json({ expense: serializeExpense(expense), comments });
});

router.put('/:id', requireAuth, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  if (!isExpenseParticipant(expense.id, req.userId) && expense.paid_by !== req.userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const { description, amount, currency, category, date, paidBy, splitType, participants } = req.body || {};
  const amountNum = amount !== undefined ? Number(amount) : expense.amount;
  const payerId = paidBy !== undefined ? Number(paidBy) : expense.paid_by;
  const finalSplitType = splitType || expense.split_type;

  let members = null;
  if (expense.group_id) {
    members = new Set(getGroupMemberIds(expense.group_id));
    if (!members.has(payerId)) return res.status(400).json({ error: 'Payer must be a member of the group' });
  }

  let shares;
  try {
    shares = participants
      ? computeShares(finalSplitType, amountNum, participants)
      : db.prepare('SELECT user_id AS userId, amount FROM expense_shares WHERE expense_id = ?').all(expense.id).map((s) => ({
          userId: s.userId,
          amountCents: Math.round(s.amount * 100),
        }));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (members) {
    for (const s of shares) {
      if (!members.has(s.userId)) return res.status(400).json({ error: 'All participants must be members of the group' });
    }
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE expenses SET description = ?, amount = ?, currency = ?, category = ?, paid_by = ?, split_type = ?, date = ?
       WHERE id = ?`
    ).run(
      description && description.trim() ? description.trim() : expense.description,
      amountNum,
      currency || expense.currency,
      category || expense.category,
      payerId,
      finalSplitType,
      date || expense.date,
      expense.id
    );
    if (participants) {
      db.prepare('DELETE FROM expense_shares WHERE expense_id = ?').run(expense.id);
      const insertShare = db.prepare('INSERT INTO expense_shares (expense_id, user_id, amount) VALUES (?, ?, ?)');
      for (const s of shares) insertShare.run(expense.id, s.userId, fromCents(s.amountCents));
    }
  });
  tx();

  const updated = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expense.id);
  res.json({ expense: serializeExpense(updated) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  if (!isExpenseParticipant(expense.id, req.userId) && expense.paid_by !== req.userId) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare('UPDATE expenses SET deleted = 1 WHERE id = ?').run(expense.id);
  res.json({ ok: true });
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const expense = db.prepare('SELECT * FROM expenses WHERE id = ? AND deleted = 0').get(req.params.id);
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  if (expense.group_id) {
    if (!isGroupMember(expense.group_id, req.userId)) return res.status(403).json({ error: 'Not authorized' });
  } else if (!isExpenseParticipant(expense.id, req.userId)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  const info = db.prepare('INSERT INTO comments (expense_id, user_id, body) VALUES (?, ?, ?)').run(expense.id, req.userId, body.trim());
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ comment: { id: comment.id, body: comment.body, createdAt: comment.created_at, user: publicUser(getUserById(req.userId)) } });
});

module.exports = router;
