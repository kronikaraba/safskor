import { sql } from '../db.js';

// Admin'in elle girdiği maçlar (API-Football'dan bağımsız). ID'ler yüksek
// tabandan üretilir (db.js'deki manual_match_id_seq / manual_player_id_seq).

/**
 * Maç + iki takımın kadrosunu tek transaction'da oluşturur.
 * lineups: { home: [{name, number, pos, isStarter}], away: [...] }
 */
export async function createManualMatch(data) {
  const {
    competition,
    stage = null,
    homeName,
    awayName,
    kickoff,
    venue = null,
    createdBy,
    lineups = { home: [], away: [] },
  } = data;

  return sql.begin(async (tx) => {
    const [match] = await tx`
      INSERT INTO manual_matches (competition, stage, home_name, away_name, kickoff, venue, created_by)
      VALUES (${competition}, ${stage}, ${homeName}, ${awayName}, ${kickoff}, ${venue}, ${createdBy})
      RETURNING *
    `;

    for (const side of ['home', 'away']) {
      const players = Array.isArray(lineups[side]) ? lineups[side] : [];
      let order = 0;
      for (const p of players) {
        await tx`
          INSERT INTO manual_lineup_players (match_id, side, name, number, pos, is_starter, sort_order)
          VALUES (${match.id}, ${side}, ${p.name}, ${p.number ?? null}, ${p.pos ?? null},
                  ${p.isStarter !== false}, ${order})
        `;
        order += 1;
      }
    }
    return match;
  });
}

/** Verilen UTC tarihindeki (YYYY-MM-DD) manuel maçlar. */
export async function listManualMatchesByDate(date) {
  return sql`
    SELECT * FROM manual_matches
    WHERE (kickoff AT TIME ZONE 'UTC')::date = ${date}::date
    ORDER BY kickoff ASC
  `;
}

/**
 * İleri tarihli manuel maçlar (ana sayfa "özel maçlar" bölümü). Ana sayfanın
 * tarih penceresi +7 günle sınırlı olduğundan, daha uzak maçlar bu listeyle
 * üyelere duyurulur.
 */
export async function listUpcomingManualMatches({ limit = 20 } = {}) {
  return sql`
    SELECT * FROM manual_matches
    WHERE kickoff > NOW() AND status NOT IN ('CANC', 'ABD', 'PST')
    ORDER BY kickoff ASC
    LIMIT ${limit}
  `;
}

/** Yönetim paneli için tüm manuel maçlar (yeni → eski). */
export async function listManualMatches({ limit = 100 } = {}) {
  return sql`
    SELECT * FROM manual_matches
    ORDER BY kickoff DESC
    LIMIT ${limit}
  `;
}

export async function getManualMatchRow(id) {
  const [row] = await sql`SELECT * FROM manual_matches WHERE id = ${id}`;
  return row ?? null;
}

export async function getManualLineupRows(id) {
  return sql`
    SELECT * FROM manual_lineup_players
    WHERE match_id = ${id}
    ORDER BY side, is_starter DESC, sort_order ASC
  `;
}

/** Yalnızca durum/skor alanlarını günceller (verilenler). */
export async function updateManualMatch(id, fields) {
  const map = {
    status: fields.status,
    minute: fields.minute,
    home_score: fields.homeScore,
    away_score: fields.awayScore,
    ht_home: fields.htHome,
    ht_away: fields.htAway,
  };
  const patch = { updated_at: new Date() };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) patch[col] = val;
  }

  const [row] = await sql`
    UPDATE manual_matches SET ${sql(patch, ...Object.keys(patch))}
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

export async function deleteManualMatch(id) {
  await sql`DELETE FROM manual_matches WHERE id = ${id}`;
}

export async function listManualEvents(id) {
  return sql`
    SELECT * FROM manual_events
    WHERE match_id = ${id}
    ORDER BY COALESCE(minute, 999) ASC, id ASC
  `;
}

export async function addManualEvent({ matchId, side, type, minute, player, playerOut, detail }) {
  const [row] = await sql`
    INSERT INTO manual_events (match_id, side, type, minute, player, player_out, detail)
    VALUES (${matchId}, ${side}, ${type}, ${minute ?? null}, ${player ?? null},
            ${playerOut ?? null}, ${detail ?? null})
    RETURNING *
  `;
  return row;
}

export async function deleteManualEvent(matchId, eventId) {
  await sql`DELETE FROM manual_events WHERE id = ${eventId} AND match_id = ${matchId}`;
}
