import { apiGet } from './client.js';
import { ApiError } from '../utils/http.js';
import * as N from './normalize.js';

// Cache TTL'leri, istemci polling araliklarinin biraz altinda tutulur:
// boylece ayni veriye bakan tum kullanicilar tek API istegini paylasir
// (API-Football ucretsiz plan: gunde 100 istek).
const TTL = {
  matchesByDate: 50 * 1000,
  matchDetail: 50 * 1000,
  events: 50 * 1000,
  lineups: 5 * 60 * 1000,
  standings: 30 * 60 * 1000,
};

// Yalnızca bu turnuvalar gösterilir (API-Football lig ID'leri):
//  1 = FIFA World Cup
//  2 = UEFA Champions League
//  3 = UEFA Europa League
//  5 = UEFA Nations League
// 203 = Türkiye Süper Lig
export const ALLOWED_LEAGUE_IDS = new Set([1, 2, 3, 5, 203]);

function isAllowed(match) {
  return ALLOWED_LEAGUE_IDS.has(Number(match.competition?.id));
}

export async function getMatchesByDate(date) {
  const data = await apiGet(`/fixtures?date=${date}`, { ttlMs: TTL.matchesByDate });
  const matches = (data.response ?? [])
    .map(N.normalizeFixture)
    .filter(isAllowed);

  const groups = { live: [], upcoming: [], finished: [], other: [] };
  for (const m of matches) groups[m.statusGroup].push(m);

  const byKickoff = (a, b) => new Date(a.utcDate) - new Date(b.utcDate);
  for (const k of Object.keys(groups)) groups[k].sort(byKickoff);

  return { date, count: matches.length, ...groups };
}

export async function getMatch(id) {
  const data = await apiGet(`/fixtures?id=${id}`, { ttlMs: TTL.matchDetail });
  const item = data.response?.[0];
  if (!item) throw new ApiError(404, 'Maç bulunamadı.');
  return N.normalizeFixture(item);
}

export async function getMatchEvents(id) {
  const data = await apiGet(`/fixtures/events?fixture=${id}`, { ttlMs: TTL.events });
  return N.normalizeEvents(data.response);
}

/** Bir macin iki takiminin dizilisleri (saha gorunumu + puanlama/sohbet oyuncu listesi). */
export async function getMatchLineups(id) {
  const match = await getMatch(id);
  const data = await apiGet(`/fixtures/lineups?fixture=${id}`, { ttlMs: TTL.lineups });
  const teams = (data.response ?? []).map(N.normalizeLineup);

  const homeId = match.homeTeam?.id;
  const awayId = match.awayTeam?.id;
  const home = teams.find((t) => t.teamId === homeId) ?? teams[0] ?? null;
  const away = teams.find((t) => t.teamId === awayId) ?? teams[1] ?? null;

  return {
    matchId: match.id,
    canRate: match.canRate,
    statusGroup: match.statusGroup,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    home,
    away,
  };
}

export async function getStandings(leagueId, season) {
  const data = await apiGet(
    `/standings?league=${encodeURIComponent(leagueId)}&season=${encodeURIComponent(season)}`,
    { ttlMs: TTL.standings }
  );
  return N.normalizeStandings(data.response);
}

/** Sadece durum (puanlama/oneri acik mi kontrolu icin - cache'ten gelir). */
export async function getMatchStatusGroup(id) {
  return (await getMatch(id)).statusGroup;
}
