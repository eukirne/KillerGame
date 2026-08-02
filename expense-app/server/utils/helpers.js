const db = require('../db/db');

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, avatarColor: u.avatar_color };
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
}

function ensureFriendship(userIdA, userIdB) {
  if (userIdA === userIdB) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)');
  stmt.run(userIdA, userIdB);
  stmt.run(userIdB, userIdA);
}

function isGroupMember(groupId, userId) {
  return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
}

function getGroupMemberIds(groupId) {
  return db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .all(groupId)
    .map((r) => r.user_id);
}

module.exports = { publicUser, getUserById, getUserByEmail, ensureFriendship, isGroupMember, getGroupMemberIds };
