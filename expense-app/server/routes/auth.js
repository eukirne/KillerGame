const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db/db');
const { signToken, requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const {
  meUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  getUserByPhone,
  getUserByIdentifier,
  generateUniqueUsername,
} = require('../utils/helpers');

const router = express.Router();

const AVATAR_COLORS = ['#1cc29f', '#5c6bc0', '#ef6c6c', '#f4a940', '#7e57c2', '#26a69a', '#ec6ba5'];
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d+\-\s()]{6,20}$/;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'MXN', 'BRL', 'CHF'];

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
    const { name, username, email, phone, password } = req.body || {};

    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!username || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscore' });
    }
    const cleanEmail = email && email.trim() ? email.trim().toLowerCase() : null;
    const cleanPhone = phone && phone.trim() ? phone.trim() : null;
    if (!cleanEmail && !cleanPhone) return res.status(400).json({ error: 'Provide an email or phone number' });
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'That email address looks invalid' });
    if (cleanPhone && !PHONE_RE.test(cleanPhone)) return res.status(400).json({ error: 'That phone number looks invalid' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    if (await getUserByUsername(username)) return res.status(409).json({ error: 'That username is already taken' });
    if (cleanEmail && (await getUserByEmail(cleanEmail))) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    if (cleanPhone && (await getUserByPhone(cleanPhone))) {
      return res.status(409).json({ error: 'An account with that phone number already exists' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.run(
      'INSERT INTO users (name, username, email, phone, password_hash, avatar_color) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      [name.trim(), username.toLowerCase(), cleanEmail, cleanPhone, hash, randomAvatarColor()]
    );

    const user = await getUserById(result.rows[0].id);
    const token = signToken(user.id);
    res.status(201).json({ token, user: meUser(user) });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ error: 'Username/email/phone and password are required' });

    const user = await getUserByIdentifier(identifier);
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(user.id);
    res.json({ token, user: meUser(user) });
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
      // Link to an existing account with the same (Google-verified) email.
      user = await getUserByEmail(email);
      if (user) {
        await db.run('UPDATE users SET google_id = ? WHERE id = ?', [payload.sub, user.id]);
      } else {
        const username = await generateUniqueUsername(email.split('@')[0]);
        const result = await db.run(
          'INSERT INTO users (name, username, email, google_id, avatar_color) VALUES (?, ?, ?, ?, ?) RETURNING id',
          [payload.name || email, username, email, payload.sub, randomAvatarColor()]
        );
        user = await getUserById(result.rows[0].id);
      }
    }

    const token = signToken(user.id);
    res.json({ token, user: meUser(user) });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: meUser(user) });
  })
);

router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const current = await getUserById(req.userId);
    if (!current) return res.status(404).json({ error: 'User not found' });

    const { name, username, email, phone, defaultCurrency } = req.body || {};
    const updates = {};

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'Name cannot be empty' });
      updates.name = name.trim();
    }

    if (username !== undefined && username.toLowerCase() !== current.username) {
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscore' });
      }
      const existing = await getUserByUsername(username);
      if (existing && existing.id !== req.userId) return res.status(409).json({ error: 'That username is already taken' });
      updates.username = username.toLowerCase();
    }

    let finalEmail = current.email;
    if (email !== undefined) {
      const cleanEmail = email.trim() ? email.trim().toLowerCase() : null;
      if (cleanEmail !== current.email) {
        if (cleanEmail) {
          if (!EMAIL_RE.test(cleanEmail)) return res.status(400).json({ error: 'That email address looks invalid' });
          const existing = await getUserByEmail(cleanEmail);
          if (existing && existing.id !== req.userId) return res.status(409).json({ error: 'That email is already in use' });
        }
        updates.email = cleanEmail;
        finalEmail = cleanEmail;
      }
    }

    let finalPhone = current.phone;
    if (phone !== undefined) {
      const cleanPhone = phone.trim() ? phone.trim() : null;
      if (cleanPhone !== current.phone) {
        if (cleanPhone) {
          if (!PHONE_RE.test(cleanPhone)) return res.status(400).json({ error: 'That phone number looks invalid' });
          const existing = await getUserByPhone(cleanPhone);
          if (existing && existing.id !== req.userId) return res.status(409).json({ error: 'That phone number is already in use' });
        }
        updates.phone = cleanPhone;
        finalPhone = cleanPhone;
      }
    }

    if (!finalEmail && !finalPhone) {
      return res.status(400).json({ error: 'You need at least an email or phone number on your account' });
    }

    if (defaultCurrency !== undefined) {
      if (!CURRENCIES.includes(defaultCurrency)) return res.status(400).json({ error: 'Unsupported currency' });
      updates.default_currency = defaultCurrency;
    }

    const keys = Object.keys(updates);
    if (keys.length) {
      const setClause = keys.map((k) => `${k} = ?`).join(', ');
      await db.run(`UPDATE users SET ${setClause} WHERE id = ?`, [...keys.map((k) => updates[k]), req.userId]);
    }

    const updated = await getUserById(req.userId);
    res.json({ user: meUser(updated) });
  })
);

module.exports = router;
