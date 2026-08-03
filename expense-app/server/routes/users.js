const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { publicUser, getUserById, getUserByEmail, ensureFriendship } = require('../utils/helpers');
const { getUserBalances, fromCents } = require('../utils/balances');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/friends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const friendRows = await db.all('SELECT friend_id FROM friendships WHERE user_id = ?', [req.userId]);
    const friendIds = friendRows.map((r) => r.friend_id);

    const userBalances = await getUserBalances(req.userId);
    const balances = new Map(userBalances.map((b) => [b.userId, b.netCents]));

    const friends = await Promise.all(
      friendIds.map(async (id) => ({
        ...publicUser(await getUserById(id)),
        balance: fromCents(balances.get(id) || 0),
      }))
    );
    friends.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ friends });
  })
);

router.post(
  '/friends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    const user = await getUserByEmail(email || '');
    if (!user) return res.status(404).json({ error: 'No user found with that email' });
    if (user.id === req.userId) return res.status(400).json({ error: "You can't add yourself as a friend" });
    await ensureFriendship(req.userId, user.id);
    res.status(201).json({ friend: { ...publicUser(user), balance: 0 } });
  })
);

router.get(
  '/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email query param is required' });
    const user = await getUserByEmail(email);
    res.json({ user: user ? publicUser(user) : null });
  })
);

module.exports = router;
