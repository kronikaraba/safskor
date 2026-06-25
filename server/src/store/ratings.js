import { sql } from '../db.js';

function round1(n) {
  return Math.round(n * 10) / 10;
}

export async function upsertRating({ matchId, playerId, userId, score }) {
  await sql`
    INSERT INTO ratings (match_id, player_id, user_id, score)
    VALUES (${matchId}, ${playerId}, ${userId}, ${score})
    ON CONFLICT (match_id, player_id, user_id)
    DO UPDATE SET score = EXCLUDED.score, updated_at = NOW()
  `;
  return getPlayerAverage(matchId, playerId);
}

export async function getPlayerAverage(matchId, playerId) {
  const [row] = await sql`
    SELECT COUNT(*)::int AS count, AVG(score)::float AS avg
    FROM ratings WHERE match_id = ${matchId} AND player_id = ${playerId}
  `;
  return {
    matchId: Number(matchId),
    playerId: Number(playerId),
    count: row.count,
    average: row.count ? round1(row.avg) : null,
  };
}

/** Bir maçın tüm oyuncularının ortalamaları: { [playerId]: { count, average } } */
export async function getMatchAverages(matchId) {
  const rows = await sql`
    SELECT player_id, COUNT(*)::int AS count, AVG(score)::float AS avg
    FROM ratings WHERE match_id = ${matchId} GROUP BY player_id
  `;
  const map = {};
  for (const r of rows) {
    const pid = Number(r.player_id);
    map[pid] = { playerId: pid, count: r.count, average: round1(r.avg) };
  }
  return map;
}

/** Bir kullanıcının bu maçtaki verdiği puanlar: { [playerId]: score } */
export async function getUserMatchRatings(matchId, userId) {
  const rows = await sql`
    SELECT player_id, score FROM ratings
    WHERE match_id = ${matchId} AND user_id = ${userId}
  `;
  const map = {};
  for (const r of rows) map[Number(r.player_id)] = r.score;
  return map;
}
