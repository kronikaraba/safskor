import { sql, toIso } from '../db.js';

export function publicMessage(row) {
  return {
    id: Number(row.id),
    room: row.room,
    userId: Number(row.user_id),
    username: row.username,
    role: row.role ?? 'user',
    content: row.is_deleted ? null : row.content,
    isDeleted: !!row.is_deleted,
    createdAt: toIso(row.created_at),
    likeCount: Number(row.like_count ?? 0),
    liked: !!row.liked,
  };
}

export async function getMessageById(id) {
  const [row] = await sql`
    SELECT m.*, u.username, u.role,
           (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_id = m.id) AS like_count
    FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.id = ${id}
  `;
  return row ? publicMessage(row) : null;
}

/** Bir mesajın beğenisini açar/kapar. { liked, likeCount } döner. */
export async function toggleLike(messageId, userId) {
  const [existing] = await sql`
    SELECT id FROM message_likes WHERE message_id = ${messageId} AND user_id = ${userId}
  `;
  if (existing) {
    await sql`DELETE FROM message_likes WHERE id = ${existing.id}`;
  } else {
    await sql`INSERT INTO message_likes (message_id, user_id) VALUES (${messageId}, ${userId})`;
  }
  const [c] = await sql`
    SELECT COUNT(*)::int AS n FROM message_likes WHERE message_id = ${messageId}
  `;
  return { liked: !existing, likeCount: c.n };
}

/** Ham satır (moderasyon için user_id, room lazım). */
export async function getMessageRow(id) {
  const [row] = await sql`SELECT * FROM messages WHERE id = ${id}`;
  return row || null;
}

export async function insertMessage({ room, scope, matchId, playerId = null, userId, content }) {
  const [row] = await sql`
    INSERT INTO messages (room, scope, match_id, player_id, user_id, content)
    VALUES (${room}, ${scope}, ${matchId}, ${playerId}, ${userId}, ${content})
    RETURNING id
  `;
  return getMessageById(row.id);
}

/** En yeni <= limit mesajı eskiden yeniye sıralı döner. userId verilirse `liked` doldurulur. */
export async function listMessages({ room, beforeId = null, limit = 50, userId = null }) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const rows = beforeId
    ? await sql`
        SELECT m.id, m.room, m.user_id, u.username, u.role, m.content, m.is_deleted, m.created_at,
               (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_id = m.id) AS like_count,
               EXISTS(
                 SELECT 1 FROM message_likes ml WHERE ml.message_id = m.id AND ml.user_id = ${userId}
               ) AS liked
        FROM messages m JOIN users u ON u.id = m.user_id
        WHERE m.room = ${room} AND m.id < ${beforeId}
        ORDER BY m.id DESC LIMIT ${safeLimit}
      `
    : await sql`
        SELECT m.id, m.room, m.user_id, u.username, u.role, m.content, m.is_deleted, m.created_at,
               (SELECT COUNT(*) FROM message_likes ml WHERE ml.message_id = m.id) AS like_count,
               EXISTS(
                 SELECT 1 FROM message_likes ml WHERE ml.message_id = m.id AND ml.user_id = ${userId}
               ) AS liked
        FROM messages m JOIN users u ON u.id = m.user_id
        WHERE m.room = ${room}
        ORDER BY m.id DESC LIMIT ${safeLimit}
      `;
  return rows.reverse().map(publicMessage);
}

export async function softDeleteMessage(id, adminId) {
  await sql`UPDATE messages SET is_deleted = TRUE, deleted_by = ${adminId} WHERE id = ${id}`;
  return getMessageById(id);
}

/** Admin paneli için son mesajlar (silinmemiş dahil). */
export async function listRecentMessages({ limit = 80, search = '' } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const rows = search
    ? await sql`
        SELECT m.id, m.room, m.scope, m.match_id, m.player_id, m.user_id, u.username,
               m.content, m.is_deleted, m.created_at
        FROM messages m JOIN users u ON u.id = m.user_id
        WHERE m.content ILIKE ${'%' + search + '%'} OR u.username ILIKE ${'%' + search + '%'}
        ORDER BY m.id DESC LIMIT ${safeLimit}
      `
    : await sql`
        SELECT m.id, m.room, m.scope, m.match_id, m.player_id, m.user_id, u.username,
               m.content, m.is_deleted, m.created_at
        FROM messages m JOIN users u ON u.id = m.user_id
        ORDER BY m.id DESC LIMIT ${safeLimit}
      `;
  return rows.map((r) => ({
    id: Number(r.id),
    room: r.room,
    scope: r.scope,
    match_id: r.match_id != null ? Number(r.match_id) : null,
    player_id: r.player_id != null ? Number(r.player_id) : null,
    user_id: Number(r.user_id),
    username: r.username,
    content: r.content,
    is_deleted: !!r.is_deleted,
    created_at: toIso(r.created_at),
  }));
}
