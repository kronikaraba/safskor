import { sql, toIso } from '../db.js';

export function publicSuggestion(row, votedSet) {
  return {
    id: Number(row.id),
    matchId: Number(row.match_id),
    userId: Number(row.user_id),
    username: row.username,
    role: row.role ?? 'user',
    type: row.type,
    content: row.content,
    voteCount: Number(row.vote_count ?? 0),
    voted: votedSet ? votedSet.has(Number(row.id)) : false,
    createdAt: toIso(row.created_at),
  };
}

export async function userVoteSet(matchId, userId) {
  const rows = await sql`
    SELECT v.suggestion_id AS id
    FROM suggestion_votes v JOIN suggestions s ON s.id = v.suggestion_id
    WHERE s.match_id = ${matchId} AND v.user_id = ${userId}
  `;
  return new Set(rows.map((r) => Number(r.id)));
}

export async function listSuggestions(matchId, userId = null) {
  const rows = await sql`
    SELECT s.*, u.username, u.role,
           (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS vote_count
    FROM suggestions s JOIN users u ON u.id = s.user_id
    WHERE s.match_id = ${matchId} AND s.is_deleted = FALSE
    ORDER BY vote_count DESC, s.id DESC
  `;
  const votedSet = userId ? await userVoteSet(matchId, userId) : null;
  return rows.map((r) => publicSuggestion(r, votedSet));
}

export async function getSuggestionById(id, userId = null) {
  const [row] = await sql`
    SELECT s.*, u.username, u.role,
           (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS vote_count
    FROM suggestions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ${id}
  `;
  if (!row) return null;
  let voted = false;
  if (userId) {
    const [v] = await sql`
      SELECT 1 FROM suggestion_votes
      WHERE suggestion_id = ${id} AND user_id = ${userId}
    `;
    voted = !!v;
  }
  const s = publicSuggestion(row);
  s.voted = voted;
  return s;
}

export async function getSuggestionRow(id) {
  const [row] = await sql`SELECT * FROM suggestions WHERE id = ${id}`;
  return row || null;
}

export async function createSuggestion({ matchId, userId, type, content }) {
  const [row] = await sql`
    INSERT INTO suggestions (match_id, user_id, type, content)
    VALUES (${matchId}, ${userId}, ${type}, ${content})
    RETURNING id
  `;
  return getSuggestionById(row.id, userId);
}

export async function getVoteCount(suggestionId) {
  const [row] = await sql`
    SELECT COUNT(*)::int AS n FROM suggestion_votes WHERE suggestion_id = ${suggestionId}
  `;
  return row.n;
}

/** Oy varsa kaldırır, yoksa ekler. { voted, voteCount } döner. */
export async function toggleVote(suggestionId, userId) {
  const [existing] = await sql`
    SELECT id FROM suggestion_votes
    WHERE suggestion_id = ${suggestionId} AND user_id = ${userId}
  `;
  if (existing) {
    await sql`DELETE FROM suggestion_votes WHERE id = ${existing.id}`;
    return { voted: false, voteCount: await getVoteCount(suggestionId) };
  }
  await sql`
    INSERT INTO suggestion_votes (suggestion_id, user_id)
    VALUES (${suggestionId}, ${userId})
  `;
  return { voted: true, voteCount: await getVoteCount(suggestionId) };
}

export async function softDeleteSuggestion(id, adminId) {
  await sql`UPDATE suggestions SET is_deleted = TRUE, deleted_by = ${adminId} WHERE id = ${id}`;
}

/** Admin paneli için son öneriler. */
export async function listRecentSuggestions({ limit = 80 } = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const rows = await sql`
    SELECT s.id, s.match_id, s.type, s.content, s.is_deleted, s.created_at,
           s.user_id, u.username,
           (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS vote_count
    FROM suggestions s JOIN users u ON u.id = s.user_id
    ORDER BY s.id DESC LIMIT ${safeLimit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    match_id: Number(r.match_id),
    type: r.type,
    content: r.content,
    is_deleted: !!r.is_deleted,
    created_at: toIso(r.created_at),
    user_id: Number(r.user_id),
    username: r.username,
    vote_count: Number(r.vote_count),
  }));
}
