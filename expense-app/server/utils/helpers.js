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

async function ensureFriendship(userIdA, userIdB, conn = db) {
  if (userIdA === userIdB) return;
  const sql = 'INSERT INTO friendships (user_id, friend_id) VALUES (?, ?) ON CONFLICT DO NOTHING';
  await conn.run(sql, [userIdA, userIdB]);
  await conn.run(sql, [userIdB, userIdA]);
}

async function isGroupMember(groupId, userId, conn = db) {
  const row = await conn.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
  return !!row;
}

async function getGroupMemberIds(groupId, conn = db) {
  const rows = await conn.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
  return rows.map((r) => r.user_id);
}

module.exports = { publicUser, getUserById, getUserByEmail, ensureFriendship, isGroupMember, getGroupMemberIds };
