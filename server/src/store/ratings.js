import { db } from '../db.js';

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function upsertRating({ matchId, playerId, userId, score }) {
  db.prepare(
    `INSERT INTO ratings (match_id, player_id, user_id, score)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(match_id, player_id, user_id)
     DO UPDATE SET score = excluded.score,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(matchId, playerId, userId, score);
  return getPlayerAverage(matchId, playerId);
}

export function getPlayerAverage(matchId, playerId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, AVG(score) AS avg
       FROM ratings WHERE match_id = ? AND player_id = ?`
    )
    .get(matchId, playerId);
  return {
    matchId: Number(matchId),
    playerId: Number(playerId),
    count: row.count,
    average: row.count ? round1(row.avg) : null,
  };
}

/** Bir macin tum oyuncularinin ortalamalari: { [playerId]: { count, average } } */
export function getMatchAverages(matchId) {
  const rows = db
    .prepare(
      `SELECT player_id, COUNT(*) AS count, AVG(score) AS avg
       FROM ratings WHERE match_id = ? GROUP BY player_id`
    )
    .all(matchId);
  const map = {};
  for (const r of rows) {
    map[r.player_id] = { playerId: r.player_id, count: r.count, average: round1(r.avg) };
  }
  return map;
}

/** Bir kullanicinin bu mactaki verdigi puanlar: { [playerId]: score } */
export function getUserMatchRatings(matchId, userId) {
  const rows = db
    .prepare('SELECT player_id, score FROM ratings WHERE match_id = ? AND user_id = ?')
    .all(matchId, userId);
  const map = {};
  for (const r of rows) map[r.player_id] = r.score;
  return map;
}
