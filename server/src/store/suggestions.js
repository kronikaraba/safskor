import { db } from '../db.js';

export function publicSuggestion(row, votedSet) {
  return {
    id: row.id,
    matchId: row.match_id,
    userId: row.user_id,
    username: row.username,
    role: row.role ?? 'user',
    type: row.type,
    content: row.content,
    voteCount: row.vote_count ?? 0,
    voted: votedSet ? votedSet.has(row.id) : false,
    createdAt: row.created_at,
  };
}

const SELECT_ONE = `
  SELECT s.*, u.username, u.role,
         (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS vote_count
  FROM suggestions s JOIN users u ON u.id = s.user_id
  WHERE s.id = ?`;

export function userVoteSet(matchId, userId) {
  const rows = db
    .prepare(
      `SELECT v.suggestion_id AS id
       FROM suggestion_votes v JOIN suggestions s ON s.id = v.suggestion_id
       WHERE s.match_id = ? AND v.user_id = ?`
    )
    .all(matchId, userId);
  return new Set(rows.map((r) => r.id));
}

export function listSuggestions(matchId, userId = null) {
  const rows = db
    .prepare(
      `SELECT s.*, u.username, u.role,
              (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS vote_count
       FROM suggestions s JOIN users u ON u.id = s.user_id
       WHERE s.match_id = ? AND s.is_deleted = 0
       ORDER BY vote_count DESC, s.id DESC`
    )
    .all(matchId);
  const votedSet = userId ? userVoteSet(matchId, userId) : null;
  return rows.map((r) => publicSuggestion(r, votedSet));
}

export function getSuggestionById(id, userId = null) {
  const row = db.prepare(SELECT_ONE).get(id);
  if (!row) return null;
  const voted = userId
    ? !!db
        .prepare('SELECT 1 FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?')
        .get(id, userId)
    : false;
  const s = publicSuggestion(row);
  s.voted = voted;
  return s;
}

export function getSuggestionRow(id) {
  return db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id);
}

export function createSuggestion({ matchId, userId, type, content }) {
  const info = db
    .prepare('INSERT INTO suggestions (match_id, user_id, type, content) VALUES (?, ?, ?, ?)')
    .run(matchId, userId, type, content);
  return getSuggestionById(Number(info.lastInsertRowid), userId);
}

export function getVoteCount(suggestionId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM suggestion_votes WHERE suggestion_id = ?')
    .get(suggestionId).n;
}

/** Oy varsa kaldirir, yoksa ekler. { voted, voteCount } doner. */
export function toggleVote(suggestionId, userId) {
  const existing = db
    .prepare('SELECT id FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?')
    .get(suggestionId, userId);
  if (existing) {
    db.prepare('DELETE FROM suggestion_votes WHERE id = ?').run(existing.id);
    return { voted: false, voteCount: getVoteCount(suggestionId) };
  }
  db.prepare('INSERT INTO suggestion_votes (suggestion_id, user_id) VALUES (?, ?)').run(
    suggestionId,
    userId
  );
  return { voted: true, voteCount: getVoteCount(suggestionId) };
}

export function softDeleteSuggestion(id, adminId) {
  db.prepare('UPDATE suggestions SET is_deleted = 1, deleted_by = ? WHERE id = ?').run(adminId, id);
}

/** Admin paneli icin son oneriler. */
export function listRecentSuggestions({ limit = 80 } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return db
    .prepare(
      `SELECT s.id, s.match_id, s.type, s.content, s.is_deleted, s.created_at,
              s.user_id, u.username,
              (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS vote_count
       FROM suggestions s JOIN users u ON u.id = s.user_id
       ORDER BY s.id DESC LIMIT ?`
    )
    .all(safeLimit);
}
