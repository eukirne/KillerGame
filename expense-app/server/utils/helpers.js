const db = require('../db/db');

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, username: u.username, email: u.email, avatarColor: u.avatar_color };
}

// Fuller serialization for "my own profile" (settings page) — includes
// fields we never expose about other users, like phone and currency prefs.
function meUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    phone: u.phone,
    avatarColor: u.avatar_color,
    defaultCurrency: u.default_currency,
    hasPassword: !!u.password_hash,
  };
}

// Every helper below takes an optional trailing `conn` (defaults to the
// top-level pool). Pass a transaction handle from db.transaction(async (tx) => ...)
// so these reads/writes stay part of the same Postgres transaction.

async function getUserById(id, conn = db) {
  return conn.get('SELECT * FROM users WHERE id = ?', [id]);
}

// Batched form of getUserById — one round trip for a whole list instead of
// one per row. Returns Map<id, userRow>; missing/duplicate ids are handled
// gracefully (an id with no matching user is simply absent from the map).
async function getUsersByIds(ids, conn = db) {
  const unique = [...new Set(ids)].filter((id) => id != null);
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const rows = await conn.all(`SELECT * FROM users WHERE id IN (${placeholders})`, unique);
  return new Map(rows.map((r) => [r.id, r]));
}

async function getUserByEmail(email, conn = db) {
  return conn.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
}

async function getUserByUsername(username, conn = db) {
  return conn.get('SELECT * FROM users WHERE username = ?', [String(username).toLowerCase()]);
}

async function getUserByPhone(phone, conn = db) {
  return conn.get('SELECT * FROM users WHERE phone = ?', [String(phone).trim()]);
}

// Looks up a user by whichever of username/email/phone the value matches —
// used for login and for finding people to friend/invite, where the caller
// doesn't know (or care) which kind of identifier was typed in.
async function getUserByIdentifier(identifier, conn = db) {
  const value = String(identifier || '').trim().toLowerCase();
  if (!value) return null;
  return conn.get('SELECT * FROM users WHERE username = ? OR email = ? OR phone = ?', [value, value, String(identifier).trim()]);
}

async function generateUniqueUsername(base, conn = db) {
  const cleaned = String(base || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 15) || 'user';
  let candidate = cleaned;
  let suffix = 0;
  // eslint-disable-next-line no-await-in-loop
  while (await getUserByUsername(candidate, conn)) {
    suffix += 1;
    candidate = `${cleaned}${suffix}`;
  }
  return candidate;
}

// The one friendships row for a pair, regardless of who is requester/addressee.
async function getFriendshipRow(userIdA, userIdB, conn = db) {
  return conn.get(
    'SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
    [userIdA, userIdB, userIdB, userIdA]
  );
}

async function areFriends(userIdA, userIdB, conn = db) {
  const row = await getFriendshipRow(userIdA, userIdB, conn);
  return !!row && row.status === 'accepted';
}

// Used by flows where friendship is a side effect of an already-mutual
// context (sharing a group or a direct expense) — always instantly
// 'accepted', no request/accept step, unlike the explicit "Add friend" flow.
async function ensureFriendship(userIdA, userIdB, conn = db) {
  if (userIdA === userIdB) return;
  const existing = await getFriendshipRow(userIdA, userIdB, conn);
  if (existing) {
    if (existing.status !== 'accepted') {
      await conn.run("UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE id = ?", [existing.id]);
    }
    return;
  }
  await conn.run("INSERT INTO friendships (requester_id, addressee_id, status, responded_at) VALUES (?, ?, 'accepted', NOW())", [
    userIdA,
    userIdB,
  ]);
}

async function isGroupMember(groupId, userId, conn = db) {
  const row = await conn.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
  return !!row;
}

async function getGroupMemberIds(groupId, conn = db) {
  const rows = await conn.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
  return rows.map((r) => r.user_id);
}

module.exports = {
  publicUser,
  meUser,
  getUserById,
  getUsersByIds,
  getUserByEmail,
  getUserByUsername,
  getUserByPhone,
  getUserByIdentifier,
  generateUniqueUsername,
  ensureFriendship,
  getFriendshipRow,
  areFriends,
  isGroupMember,
  getGroupMemberIds,
};
