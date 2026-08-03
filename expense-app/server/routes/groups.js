const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, getUserByEmail, ensureFriendship, isGroupMember, getGroupMemberIds } = require('../utils/helpers');
const { getGroupNetPositions, getGroupPairwiseBalances, simplifyDebts, fromCents } = require('../utils/balances');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

async function groupSummary(group, userId) {
  const memberIds = await getGroupMemberIds(group.id);
  const members = await Promise.all(memberIds.map(async (id) => publicUser(await getUserById(id))));
  const net = await getGroupNetPositions(group.id, memberIds);
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    createdBy: group.created_by,
    members,
    yourBalanceCents: net.get(userId) || 0,
  };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groups = await db.all(
      `SELECT g.* FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC`,
      [req.userId]
    );
    const summaries = await Promise.all(groups.map((g) => groupSummary(g, req.userId)));
    res.json({ groups: summaries });
  })
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, type, memberEmails } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

    const { groupId, invited, notFound } = await db.transaction(async (tx) => {
      const result = await tx.run('INSERT INTO groups (name, type, created_by) VALUES (?, ?, ?) RETURNING id', [
        name.trim(),
        type || 'other',
        req.userId,
      ]);
      const groupId = result.rows[0].id;
      await tx.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [groupId, req.userId]);

      const invited = [];
      const notFound = [];
      for (const rawEmail of memberEmails || []) {
        const email = String(rawEmail).trim().toLowerCase();
        if (!email) continue;
        const user = await getUserByEmail(email, tx);
        if (!user) {
          notFound.push(email);
          continue;
        }
        await tx.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [groupId, user.id]);
        await ensureFriendship(req.userId, user.id, tx);
        invited.push(publicUser(user));
      }
      return { groupId, invited, notFound };
    });

    const group = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    res.status(201).json({ group: await groupSummary(group, req.userId), invited, notFound });
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

    const memberIds = await getGroupMemberIds(groupId);
    const members = await Promise.all(memberIds.map(async (id) => publicUser(await getUserById(id))));
    const net = await getGroupNetPositions(groupId, memberIds);
    const netOut = {};
    for (const id of memberIds) netOut[id] = fromCents(net.get(id) || 0);

    const pairwiseRaw = await getGroupPairwiseBalances(groupId, memberIds);
    const pairwise = await Promise.all(
      pairwiseRaw.map(async (p) => ({
        from: publicUser(await getUserById(p.from)),
        to: publicUser(await getUserById(p.to)),
        amount: fromCents(p.amountCents),
      }))
    );

    const simplified = await Promise.all(
      simplifyDebts(net).map(async (t) => ({
        from: publicUser(await getUserById(t.from)),
        to: publicUser(await getUserById(t.to)),
        amount: fromCents(t.amountCents),
      }))
    );

    res.json({
      group: { id: group.id, name: group.name, type: group.type, createdBy: group.created_by, members },
      netBalances: netOut,
      pairwiseBalances: pairwise,
      simplifiedDebts: simplified,
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
    const updated = await db.get('SELECT * FROM groups WHERE id = ?', [groupId]);
    res.json({ group: await groupSummary(updated, req.userId) });
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

    const { email } = req.body || {};
    const user = await getUserByEmail(email || '');
    if (!user) return res.status(404).json({ error: 'No user found with that email' });

    await db.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [groupId, user.id]);
    const memberIds = await getGroupMemberIds(groupId);
    for (const id of memberIds) await ensureFriendship(id, user.id);

    res.status(201).json({ member: publicUser(user) });
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
