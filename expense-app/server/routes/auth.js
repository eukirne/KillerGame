const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db/db');
const { signToken, requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

const AVATAR_COLORS = ['#1cc29f', '#5c6bc0', '#ef6c6c', '#f4a940', '#7e57c2', '#26a69a', '#ec6ba5'];
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, avatarColor: u.avatar_color };
}

function randomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

// Lets the frontend know whether Google sign-in is configured, so it can
// show/hide the button instead of rendering one that will always fail.
router.get('/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run('INSERT INTO users (name, email, password_hash, avatar_color) VALUES (?, ?, ?, ?) RETURNING id', [
      name.trim(),
      email.toLowerCase(),
      hash,
      randomAvatarColor(),
    ]);

    const user = await db.get('SELECT * FROM users WHERE id = ?', [result.rows[0].id]);
    const token = signToken(user.id);
    res.status(201).json({ token, user: publicUser(user) });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await db.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
  })
);

router.post(
  '/google',
  asyncHandler(async (req, res) => {
    if (!googleClient) return res.status(501).json({ error: 'Google sign-in is not configured' });

    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid Google credential' });
    }

    if (!payload || !payload.email || !payload.email_verified) {
      return res.status(401).json({ error: 'Google account has no verified email' });
    }

    const email = payload.email.toLowerCase();
    let user = await db.get('SELECT * FROM users WHERE google_id = ?', [payload.sub]);

    if (!user) {
      // Link to an existing password account with the same (Google-verified) email.
      user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
      if (user) {
        await db.run('UPDATE users SET google_id = ? WHERE id = ?', [payload.sub, user.id]);
      } else {
        const result = await db.run(
          'INSERT INTO users (name, email, google_id, avatar_color) VALUES (?, ?, ?, ?) RETURNING id',
          [payload.name || email, email, payload.sub, randomAvatarColor()]
        );
        user = await db.get('SELECT * FROM users WHERE id = ?', [result.rows[0].id]);
      }
    }

    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(user) });
  })
);

module.exports = router;
