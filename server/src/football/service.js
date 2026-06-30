import { apiGet, apiGetImage } from './client.js';
import { ApiError } from '../utils/http.js';
import * as N from './normalize.js';
import {
  listManualMatchesByDate,
  getManualMatchRow,
  getManualLineupRows,
  listManualEvents,
} from '../store/manualMatches.js';

// Manuel maç ID'leri bu tabandan başlar (db.js manual_match_id_seq).
const MANUAL_ID_BASE = 9_000_000_000;
export function isManualId(id) {
  return Number(id) >= MANUAL_ID_BASE;
}

// Cache TTL'leri, istemci polling araliklarinin biraz altinda tutulur:
// boylece ayni veriye bakan tum kullanicilar tek API istegini paylasir.
const TTL = {
  matchesByDate: 50 * 1000,
  matchDetail: 50 * 1000,
  events: 50 * 1000,
  lineups: 5 * 60 * 1000,
  standings: 30 * 60 * 1000,
};

// Bir günün maçları için sorgulanan Sofascore kategori ID'leri:
//  46   = Türkiye (Süper Lig)
//  1465 = UEFA (Şampiyonlar/Avrupa/Konferans Ligi)
//  1468 = World (FIFA Dünya Kupası)
const FETCH_CATEGORY_IDS = [46, 1465, 1468];

// Yalnızca bu turnuvalar gösterilir (Sofascore uniqueTournament ID'leri):
//    52 = Trendyol Süper Lig
//     7 = UEFA Şampiyonlar Ligi
//   679 = UEFA Avrupa Ligi
// 17015 = UEFA Konferans Ligi
//    16 = FIFA Dünya Kupası
export const ALLOWED_LEAGUE_IDS = new Set([52, 7, 679, 17015, 16]);

function isAllowed(match) {
  return ALLOWED_LEAGUE_IDS.has(Number(match.competition?.id));
}

export async function getMatchesByDate(date) {
  // Her kategori ayrı istek; hata/limit olursa o kategoriyi atla, diğerleri gelsin.
  const results = await Promise.all(
    FETCH_CATEGORY_IDS.map((catId) =>
      apiGet(`/tournaments/get-scheduled-events?categoryId=${catId}&date=${date}`, {
        ttlMs: TTL.matchesByDate,
      }).catch(() => ({ events: [] }))
    )
  );

  const seen = new Set();
  const matches = [];
  for (const data of results) {
    for (const ev of data.events ?? []) {
      const m = N.normalizeFixture(ev);
      if (!isAllowed(m) || seen.has(m.id)) continue;
      seen.add(m.id);
      matches.push(m);
    }
  }

  const groups = { live: [], upcoming: [], finished: [], other: [] };
  for (const m of matches) groups[m.statusGroup].push(m);

  // Admin'in elle girdiği maçlar (lig filtresine takılmaz) aynı gruplara katılır.
  const manual = (await listManualMatchesByDate(date)).map(N.manualToMatch);
  for (const m of manual) groups[m.statusGroup].push(m);

  const byKickoff = (a, b) => new Date(a.utcDate) - new Date(b.utcDate);
  for (const k of Object.keys(groups)) groups[k].sort(byKickoff);

  return { date, count: matches.length + manual.length, ...groups };
}

export async function getMatch(id) {
  if (isManualId(id)) {
    const row = await getManualMatchRow(id);
    if (!row) throw new ApiError(404, 'Maç bulunamadı.');
    return N.manualToMatch(row);
  }
  const data = await apiGet(`/matches/detail?matchId=${id}`, { ttlMs: TTL.matchDetail });
  const event = data.event ?? data;
  if (!event?.id) throw new ApiError(404, 'Maç bulunamadı.');
  return N.normalizeFixture(event);
}

export async function getMatchEvents(id) {
  if (isManualId(id)) {
    const row = await getManualMatchRow(id);
    if (!row) throw new ApiError(404, 'Maç bulunamadı.');
    return N.manualEventsToClient(await listManualEvents(id), row.home_name, row.away_name);
  }
  // Takım adlarını (isHome eşlemesi için) maç detayından al (cache'ten gelir).
  const match = await getMatch(id);
  const data = await apiGet(`/matches/get-incidents?matchId=${id}`, { ttlMs: TTL.events });
  return N.normalizeEvents(data.incidents, match.homeTeam, match.awayTeam);
}

/** Bir macin iki takiminin dizilisleri (saha gorunumu + puanlama/sohbet oyuncu listesi). */
export async function getMatchLineups(id) {
  const match = await getMatch(id);

  if (isManualId(id)) {
    const rows = await getManualLineupRows(id);
    const homeRows = rows.filter((r) => r.side === 'home');
    const awayRows = rows.filter((r) => r.side === 'away');
    return {
      matchId: match.id,
      canRate: match.canRate,
      statusGroup: match.statusGroup,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      home: N.manualLineupTeam(homeRows, match.homeTeam?.name),
      away: N.manualLineupTeam(awayRows, match.awayTeam?.name),
    };
  }

  const data = await apiGet(`/matches/get-lineups?matchId=${id}`, { ttlMs: TTL.lineups }).catch(
    () => null
  );

  return {
    matchId: match.id,
    canRate: match.canRate,
    statusGroup: match.statusGroup,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    home: data?.home ? N.normalizeLineup(data.home, match.homeTeam) : null,
    away: data?.away ? N.normalizeLineup(data.away, match.awayTeam) : null,
  };
}

export async function getStandings(leagueId, season) {
  const data = await apiGet(
    `/tournaments/get-standings?tournamentId=${encodeURIComponent(leagueId)}&seasonId=${encodeURIComponent(season)}&type=total`,
    { ttlMs: TTL.standings }
  );
  return N.normalizeStandings(data.standings);
}

/** Takım logosu (Sofascore görselleri doğrudan 403 verir; proxy'leriz). */
export async function getTeamLogo(teamId) {
  return apiGetImage(`/teams/get-logo?teamId=${encodeURIComponent(teamId)}`);
}

/** Turnuva/lig logosu. */
export async function getLeagueLogo(tournamentId) {
  return apiGetImage(`/tournaments/get-logo?tournamentId=${encodeURIComponent(tournamentId)}`);
}

/** Sadece durum (puanlama/oneri acik mi kontrolu icin - cache'ten gelir). */
export async function getMatchStatusGroup(id) {
  return (await getMatch(id)).statusGroup;
}
