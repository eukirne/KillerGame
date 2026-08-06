const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const {
  publicUser,
  getUserById,
  getUsersByIds,
  getUserByEmail,
  ensureFriendship,
  areFriends,
  isGroupMember,
  getGroupMemberIds,
} = require('../utils/helpers');
const { getGroupNetPositions, getGroupBalances, simplifyDebts, fromCents } = require('../utils/balances');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'MXN', 'BRL', 'CHF'];

// A group's `currency` column, when set, overrides every member's own
// default currency for that group's balances — everyone sees the same
// numbers instead of each person's own converted view.
async function groupSummary(group, userId, fallbackCurrency) {
  const currency = group.currency || fallbackCurrency;
  const memberIds = await getGroupMemberIds(group.id);
  // Both only depend on memberIds, not on each other — one round trip.
  const [userById, net] = await Promise.all([getUsersByIds(memberIds), getGroupNetPositions(group.id, memberIds, currency)]);
  const members = memberIds.map((id) => publicUser(userById.get(id)));
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    createdBy: group.created_by,
    currencyOverride: group.currency || null,
    members,
    yourBalanceCents: net.get(userId) || 0,
    currency,
  };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [me, groups] = await Promise.all([
      getUserById(req.userId),
      db.all(
        `SELECT g.* FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC`,
        [req.userId]
      ),
    ]);
    const summaries = await Promise.all(groups.map((g) => groupSummary(g, req.userId, me.default_currency)));
    res.json({ groups: summaries });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, type, currency, memberIds, memberEmails } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });
    const cleanCurrency = currency ? String(currency).toUpperCase() : null;
    if (cleanCurrency && !CURRENCIES.includes(cleanCurrency)) return res.status(400).json({ error: 'Unsupported currency' });

    const { groupId, invited, notFriends, notFound } = await db.transaction(async (tx) => {
      const result = await tx.run('INSERT INTO groups (name, type, currency, created_by) VALUES (?, ?, ?, ?) RETURNING id', [
        name.trim(),
        type || 'other',
        cleanCurrency,
        req.userId,
      ]);
      const groupId = result.rows[0].id;
      await tx.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [groupId, req.userId]);

      const invited = [];
      const notFriends = [];
      const notFound = [];

      for (const rawId of memberIds || []) {
        const id = Number(rawId);
        if (!id || id === req.userId) continue;
        if (!(await areFriends(req.userId, id, tx))) {
          notFriends.push(id);
          continue;
        }
        const user = await getUserById(id, tx);
        if (!user) continue;
        await tx.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [groupId, id]);
        invited.push(publicUser(user));
      }

      for (const rawEmail of memberEmails || []) {
        const email = String(rawEmail).trim().toLowerCase();
        if (!email) continue;
        const user = await getUserByEmail(email, tx);
        if (!user) {
          notFound.push(email);
          continue;
        }
        await tx.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [groupId, user.id]);
        invited.push(publicUser(user));
      }

      // Everyone in a fresh group already shares this mutual context, so
      // friend every pair instantly rather than requiring requests.
      const allIds = [req.userId, ...invited.map((u) => u.id)];
      for (let i = 0; i < allIds.length; i++) {
        for (let j = i + 1; j < allIds.length; j++) await ensureFriendship(allIds[i], allIds[j], tx);
      }

      return { groupId, invited, notFriends, notFound };
    });

    const [me, group] = await Promise.all([getUserById(req.userId), db.get('SELECT * FROM groups WHERE id = ?', [groupId])]);
    res.status(201).json({ group: await groupSummary(group, req.userId, me.default_currency), invited, notFriends, notFound });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);

    // None of these four depend on each other's result — one round trip
    // instead of four stacked ones. (The rare 404/403 case does a little
    // unnecessary work; that's a fine trade for the common case being 4x
    // fewer round trips to a database that's an ocean away.)
    const [group, isMember, me, memberIds] = await Promise.all([
      db.get('SELECT * FROM groups WHERE id = ?', [groupId]),
      isGroupMember(groupId, req.userId),
      getUserById(req.userId),
      getGroupMemberIds(groupId),
    ]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    const currency = group.currency || me.default_currency;

    // Also independent of each other — both only need memberIds/currency.
    const [userById, { net, pairwise: pairwiseRaw }] = await Promise.all([
      getUsersByIds(memberIds),
      getGroupBalances(groupId, memberIds, currency),
    ]);
    const members = memberIds.map((id) => publicUser(userById.get(id)));
    const netOut = {};
    for (const id of memberIds) netOut[id] = fromCents(net.get(id) || 0);

    // from/to are always members of this group, so the member lookup above
    // already has every user these need — no extra queries required.
    const pairwise = pairwiseRaw.map((p) => ({
      from: publicUser(userById.get(p.from)),
      to: publicUser(userById.get(p.to)),
      amount: fromCents(p.amountCents),
    }));

    const simplified = simplifyDebts(net).map((t) => ({
      from: publicUser(userById.get(t.from)),
      to: publicUser(userById.get(t.to)),
      amount: fromCents(t.amountCents),
    }));

    res.json({
      group: {
        id: group.id,
        name: group.name,
        type: group.type,
        createdBy: group.created_by,
        currencyOverride: group.currency || null,
        members,
      },
      netBalances: netOut,
      pairwiseBalances: pairwise,
      simplifiedDebts: simplified,
      currency,
    });
  })
);

router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const [group, isMember] = await Promise.all([db.get('SELECT * FROM groups WHERE id = ?', [groupId]), isGroupMember(groupId, req.userId)]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    const { name, type, currency } = req.body || {};
    const updates = {};
    if (name && name.trim()) updates.name = name.trim();
    if (type) updates.type = type;
    // currency is explicitly settable back to null (an empty string clears
    // the override), unlike name/type which just leave the old value alone
    // when omitted — so it's checked separately rather than folded into
    // the `name && ...` / `type && ...` pattern above.
    if (currency !== undefined) {
      const cleanCurrency = currency ? String(currency).toUpperCase() : null;
      if (cleanCurrency && !CURRENCIES.includes(cleanCurrency)) return res.status(400).json({ error: 'Unsupported currency' });
      updates.currency = cleanCurrency;
    }

    const keys = Object.keys(updates);
    if (keys.length) {
      const setClause = keys.map((k) => `${k} = ?`).join(', ');
      await db.run(`UPDATE groups SET ${setClause} WHERE id = ?`, [...keys.map((k) => updates[k]), groupId]);
    }

    const [me, updated] = await Promise.all([getUserById(req.userId), db.get('SELECT * FROM groups WHERE id = ?', [groupId])]);
    res.json({ group: await groupSummary(updated, req.userId, me.default_currency) });
  })
);

router.post(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const [group, isMember, existingMemberIds] = await Promise.all([
      db.get('SELECT * FROM groups WHERE id = ?', [groupId]),
      isGroupMember(groupId, req.userId),
      getGroupMemberIds(groupId),
    ]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });

    const { userIds, email } = req.body || {};
    const added = [];
    const notFriends = [];

    if (Array.isArray(userIds) && userIds.length) {
      for (const rawId of userIds) {
        const id = Number(rawId);
        if (!id || existingMemberIds.includes(id)) continue;
        if (!(await areFriends(req.userId, id))) {
          notFriends.push(id);
          continue;
        }
        const user = await getUserById(id);
        if (!user) continue;
        await db.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [groupId, id]);
        added.push(publicUser(user));
      }
    } else if (email) {
      const user = await getUserByEmail(email);
      if (!user) return res.status(404).json({ error: 'No user found with that email' });
      await db.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [groupId, user.id]);
      added.push(publicUser(user));
    } else {
      return res.status(400).json({ error: 'Provide userIds or an email' });
    }

    if (added.length) {
      const allMemberIds = [...existingMemberIds, ...added.map((u) => u.id)];
      for (let i = 0; i < allMemberIds.length; i++) {
        for (let j = i + 1; j < allMemberIds.length; j++) await ensureFriendship(allMemberIds[i], allMemberIds[j]);
      }
    }

    res.status(201).json({ added, notFriends });
  })
);

router.delete(
  '/:id/members/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const [group, isMember] = await Promise.all([db.get('SELECT * FROM groups WHERE id = ?', [groupId]), isGroupMember(groupId, req.userId)]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' });
    if (targetId !== req.userId) return res.status(403).json({ error: 'You can only remove yourself from a group' });

    const memberIds = await getGroupMemberIds(groupId);
    const net = await getGroupNetPositions(groupId, memberIds);
    if ((net.get(targetId) || 0) !== 0) {
      return res.status(400).json({ error: 'Settle up before leaving this group' });
    }

    await db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, targetId]);
    res.json({ ok: true });
  })
);

module.exports = router;
