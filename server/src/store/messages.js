import { db } from '../db.js';

export function publicMessage(row) {
  return {
    id: row.id,
    room: row.room,
    userId: row.user_id,
    username: row.username,
    role: row.role ?? 'user',
    content: row.is_deleted ? null : row.content,
    isDeleted: !!row.is_deleted,
    createdAt: row.created_at,
  };
}

export function getMessageById(id) {
  const row = db
    .prepare(
      `SELECT m.*, u.username, u.role
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.id = ?`
    )
    .get(id);
  return row ? publicMessage(row) : null;
}

/** Ham satir (moderasyon icin user_id, room lazim). */
export function getMessageRow(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

export function insertMessage({ room, scope, matchId, playerId = null, userId, content }) {
  const info = db
    .prepare(
      `INSERT INTO messages (room, scope, match_id, player_id, user_id, content)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(room, scope, matchId, playerId, userId, content);
  return getMessageById(Number(info.lastInsertRowid));
}

/** En yeni <= limit mesaji eskiden yeniye sirali dondurur. */
export function listMessages({ room, beforeId = null, limit = 50 }) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const rows = beforeId
    ? db
        .prepare(
          `SELECT m.id, m.room, m.user_id, u.username, u.role, m.content, m.is_deleted, m.created_at
           FROM messages m JOIN users u ON u.id = m.user_id
           WHERE m.room = ? AND m.id < ?
           ORDER BY m.id DESC LIMIT ?`
        )
        .all(room, beforeId, safeLimit)
    : db
        .prepare(
          `SELECT m.id, m.room, m.user_id, u.username, u.role, m.content, m.is_deleted, m.created_at
           FROM messages m JOIN users u ON u.id = m.user_id
           WHERE m.room = ?
           ORDER BY m.id DESC LIMIT ?`
        )
        .all(room, safeLimit);
  return rows.reverse().map(publicMessage);
}

export function softDeleteMessage(id, adminId) {
  db.prepare('UPDATE messages SET is_deleted = 1, deleted_by = ? WHERE id = ?').run(adminId, id);
  return getMessageById(id);
}

/** Admin paneli icin son mesajlar (silinmemis dahil). */
export function listRecentMessages({ limit = 80, search = '' } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  if (search) {
    const like = `%${search}%`;
    return db
      .prepare(
        `SELECT m.id, m.room, m.scope, m.match_id, m.player_id, m.user_id, u.username,
                m.content, m.is_deleted, m.created_at
         FROM messages m JOIN users u ON u.id = m.user_id
         WHERE m.content LIKE ? OR u.username LIKE ?
         ORDER BY m.id DESC LIMIT ?`
      )
      .all(like, like, safeLimit);
  }
  return db
    .prepare(
      `SELECT m.id, m.room, m.scope, m.match_id, m.player_id, m.user_id, u.username,
              m.content, m.is_deleted, m.created_at
       FROM messages m JOIN users u ON u.id = m.user_id
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(safeLimit);
}
