const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, getUserByIdentifier, getFriendshipRow } = require('../utils/helpers');
const { getUserBalances, fromCents } = require('../utils/balances');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/friends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT requester_id, addressee_id FROM friendships
       WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
      [req.userId, req.userId]
    );
    const friendIds = rows.map((r) => (r.requester_id === req.userId ? r.addressee_id : r.requester_id));

    const me = await getUserById(req.userId);
    const currency = me.default_currency;
    const userBalances = await getUserBalances(req.userId, currency);
    const balances = new Map(userBalances.map((b) => [b.userId, b.netCents]));

    const friends = await Promise.all(
      friendIds.map(async (id) => ({
        ...publicUser(await getUserById(id)),
        balance: fromCents(balances.get(id) || 0),
      }))
    );
    friends.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ friends, currency });
  })
);

// Incoming friend requests awaiting a response from the current user.
router.get(
  '/friend-requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await db.all(
      `SELECT id, requester_id, created_at FROM friendships WHERE addressee_id = ? AND status = 'pending' ORDER BY created_at DESC`,
      [req.userId]
    );
    const requests = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        from: publicUser(await getUserById(r.requester_id)),
        createdAt: r.created_at,
      }))
    );
    res.json({ requests });
  })
);

router.post(
  '/friends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { identifier } = req.body || {};
    const user = await getUserByIdentifier(identifier || '');
    if (!user) return res.status(404).json({ error: 'No user found with that username, email or phone number' });
    if (user.id === req.userId) return res.status(400).json({ error: "You can't add yourself as a friend" });

    const existing = await getFriendshipRow(req.userId, user.id);
    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(409).json({ error: 'You are already friends' });
      }
      if (existing.requester_id === user.id) {
        // They'd already requested us — requesting them back accepts it immediately.
        await db.run("UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE id = ?", [existing.id]);
        return res.status(200).json({ status: 'accepted', friend: { ...publicUser(user), balance: 0 } });
      }
      return res.status(409).json({ error: 'Friend request already sent' });
    }

    await db.run("INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')", [req.userId, user.id]);
    res.status(201).json({ status: 'pending' });
  })
);

router.post(
  '/friend-requests/:id/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const request = await db.get('SELECT * FROM friendships WHERE id = ?', [req.params.id]);
    if (!request || request.addressee_id !== req.userId) return res.status(404).json({ error: 'Friend request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'This request has already been handled' });

    await db.run("UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE id = ?", [request.id]);
    const friend = await getUserById(request.requester_id);
    res.json({ friend: { ...publicUser(friend), balance: 0 } });
  })
);

router.post(
  '/friend-requests/:id/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    const request = await db.get('SELECT * FROM friendships WHERE id = ?', [req.params.id]);
    if (!request || request.addressee_id !== req.userId) return res.status(404).json({ error: 'Friend request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'This request has already been handled' });

    await db.run('DELETE FROM friendships WHERE id = ?', [request.id]);
    res.json({ ok: true });
  })
);

router.get(
  '/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'q query param is required' });
    const user = await getUserByIdentifier(q);
    res.json({ user: user ? publicUser(user) : null });
  })
);

module.exports = router;
