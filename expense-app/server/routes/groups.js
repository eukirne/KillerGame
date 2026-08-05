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
const { getGroupNetPositions, getGroupPairwiseBalances, simplifyDebts, fromCents } = require('../utils/balances');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

async function groupSummary(group, userId, currency) {
  const memberIds = await getGroupMemberIds(group.id);
  const userById = await getUsersByIds(memberIds);
  const members = memberIds.map((id) => publicUser(userById.get(id)));
  const net = await getGroupNetPositions(group.id, memberIds, currency);
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    createdBy: group.created_by,
    members,
    yourBalanceCents: net.get(userId) || 0,
    currency,
  };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = await getUserById(req.userId);
    const groups = await db.all(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC`,
      [req.userId]
    );
    const summaries = await Promise.all(groups.map((g) => groupSummary(g, req.userId, me.default_currency)));
    res.json({ groups: summaries });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, type, memberIds, memberEmails } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

    const { groupId, invited, notFriends, notFound } = await db.transaction(async (tx) => {
      const result = await tx.run('INSERT INTO groups (name, type, created_by) VALUES (?, ?, ?) RETURNING id', [
        name.trim(),
        type || 'other',
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

    const me = await getUserById(req.userId);
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    res.status(201).json({ group: await groupSummary(group, req.userId, me.default_currency), invited, notFriends, notFound });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!(await isGroupMember(groupId, req.userId))) return res.status(403).json({ error: 'Not a member of this group' });

    const me = await getUserById(req.userId);
    const currency = me.default_currency;

    const memberIds = await getGroupMemberIds(groupId);
    const userById = await getUsersByIds(memberIds);
    const members = memberIds.map((id) => publicUser(userById.get(id)));
    const net = await getGroupNetPositions(groupId, memberIds, currency);
    const netOut = {};
    for (const id of memberIds) netOut[id] = fromCents(net.get(id) || 0);

    // from/to are always members of this group, so the member lookup above
    // already has every user these need — no extra queries required.
    const pairwiseRaw = await getGroupPairwiseBalances(groupId, memberIds, currency);
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
      group: { id: group.id, name: group.name, type: group.type, createdBy: group.created_by, members },
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
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!(await isGroupMember(groupId, req.userId))) return res.status(403).json({ error: 'Not a member of this group' });
    const { name, type } = req.body || {};
    await db.run('UPDATE groups SET name = COALESCE(?, name), type = COALESCE(?, type) WHERE id = ?', [
      name && name.trim() ? name.trim() : null,
      type || null,
      groupId,
    ]);
    const me = await getUserById(req.userId);
    const updated = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    res.json({ group: await groupSummary(updated, req.userId, me.default_currency) });
  })
);

router.post(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!(await isGroupMember(groupId, req.userId))) return res.status(403).json({ error: 'Not a member of this group' });

    const { userIds, email } = req.body || {};
    const existingMemberIds = await getGroupMemberIds(groupId);
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
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!(await isGroupMember(groupId, req.userId))) return res.status(403).json({ error: 'Not a member of this group' });
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
