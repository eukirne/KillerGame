const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, getUserByEmail, ensureFriendship, isGroupMember, getGroupMemberIds } = require('../utils/helpers');
const { getGroupNetPositions, getGroupPairwiseBalances, simplifyDebts, fromCents } = require('../utils/balances');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

async function groupSummary(group, userId) {
  const memberIds = getGroupMemberIds(group.id);
  const members = memberIds.map((id) => publicUser(getUserById(id)));
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
    const groups = db
      .prepare(
        `SELECT g.* FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = ?
       ORDER BY g.created_at DESC`
      )
      .all(req.userId);
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

    const tx = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO groups (name, type, created_by) VALUES (?, ?, ?)')
        .run(name.trim(), type || 'other', req.userId);
      const groupId = info.lastInsertRowid;
      db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, req.userId);

      const invited = [];
      const notFound = [];
      for (const rawEmail of memberEmails || []) {
        const email = String(rawEmail).trim().toLowerCase();
        if (!email) continue;
        const user = getUserByEmail(email);
        if (!user) {
          notFound.push(email);
          continue;
        }
        db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, user.id);
        ensureFriendship(req.userId, user.id);
        invited.push(publicUser(user));
      }
      return { groupId, invited, notFound };
    });

    const { groupId, invited, notFound } = tx();
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    res.status(201).json({ group: await groupSummary(group, req.userId), invited, notFound });
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(groupId, req.userId)) return res.status(403).json({ error: 'Not a member of this group' });

    const memberIds = getGroupMemberIds(groupId);
    const members = memberIds.map((id) => publicUser(getUserById(id)));
    const net = await getGroupNetPositions(groupId, memberIds);
    const netOut = {};
    for (const id of memberIds) netOut[id] = fromCents(net.get(id) || 0);

    const pairwiseRaw = await getGroupPairwiseBalances(groupId, memberIds);
    const pairwise = pairwiseRaw.map((p) => ({
      from: publicUser(getUserById(p.from)),
      to: publicUser(getUserById(p.to)),
      amount: fromCents(p.amountCents),
    }));

    const simplified = simplifyDebts(net).map((t) => ({
      from: publicUser(getUserById(t.from)),
      to: publicUser(getUserById(t.to)),
      amount: fromCents(t.amountCents),
    }));

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
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(groupId, req.userId)) return res.status(403).json({ error: 'Not a member of this group' });
    const { name, type } = req.body || {};
    db.prepare('UPDATE groups SET name = COALESCE(?, name), type = COALESCE(?, type) WHERE id = ?').run(
      name && name.trim() ? name.trim() : null,
      type || null,
      groupId
    );
    const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    res.json({ group: await groupSummary(updated, req.userId) });
  })
);

router.post(
  '/:id/members',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(groupId, req.userId)) return res.status(403).json({ error: 'Not a member of this group' });

    const { email } = req.body || {};
    const user = getUserByEmail(email || '');
    if (!user) return res.status(404).json({ error: 'No user found with that email' });

    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, user.id);
    const memberIds = getGroupMemberIds(groupId);
    for (const id of memberIds) ensureFriendship(id, user.id);

    res.status(201).json({ member: publicUser(user) });
  })
);

router.delete(
  '/:id/members/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const groupId = Number(req.params.id);
    const targetId = Number(req.params.userId);
    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(groupId, req.userId)) return res.status(403).json({ error: 'Not a member of this group' });
    if (targetId !== req.userId) return res.status(403).json({ error: 'You can only remove yourself from a group' });

    const memberIds = getGroupMemberIds(groupId);
    const net = await getGroupNetPositions(groupId, memberIds);
    if ((net.get(targetId) || 0) !== 0) {
      return res.status(400).json({ error: 'Settle up before leaving this group' });
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, targetId);
    res.json({ ok: true });
  })
);

module.exports = router;
