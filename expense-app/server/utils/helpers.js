const db = require('../db/db');

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, avatarColor: u.avatar_color };
}

// Every helper below takes an optional trailing `conn` (defaults to the
// top-level pool). Pass a transaction handle from db.transaction(async (tx) => ...)
// so these reads/writes stay part of the same Postgres transaction.

async function getUserById(id, conn = db) {
  return conn.get('SELECT * FROM users WHERE id = ?', [id]);
}

async function getUserByEmail(email, conn = db) {
  return conn.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase()]);
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
  getUserById,
  getUserByEmail,
  ensureFriendship,
  getFriendshipRow,
  areFriends,
  isGroupMember,
  getGroupMemberIds,
};
