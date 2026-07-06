import { apiGet } from './client.js';
import { ApiError } from '../utils/http.js';
import * as N from './normalize.js';
import {
  listManualMatchesByDate,
  listUpcomingManualMatches,
  getManualMatchRow,
  getManualLineupRows,
  listManualEvents,
} from '../store/manualMatches.js';

// Manuel maç ID'leri bu tabandan başlar (db.js manual_match_id_seq).
const MANUAL_ID_BASE = 9_000_000_000;
export function isManualId(id) {
  return Number(id) >= MANUAL_ID_BASE;
}

// Cache TTL'leri. API-Football ücretsiz plan günde 100 istek; stale-while-
// revalidate ile yükleme yine anlıktır, bu süreler upstream istek sayısını
// (dolayısıyla günlük kotayı) düşük tutmak için uzun seçilir.
const TTL = {
  matchesToday: 10 * 60 * 1000, // bugün/gelecek: 10 dk (canlı skorlar)
  matchesPast: 24 * 60 * 60 * 1000, // geçmiş gün: 24 saat (maçlar bitti, değişmez)
  matchDetail: 10 * 60 * 1000,
  events: 10 * 60 * 1000,
  lineups: 6 * 60 * 60 * 1000,
  standings: 24 * 60 * 60 * 1000,
};

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// Yalnızca bu turnuvalar gösterilir (API-Football lig ID'leri):
//   203 = Türkiye Süper Lig
//     2 = UEFA Şampiyonlar Ligi      3 = UEFA Avrupa Ligi
//   848 = UEFA Konferans Ligi      531 = UEFA Süper Kupa
//     1 = FIFA Dünya Kupası          4 = Avrupa Şampiyonası (EURO)
//     5 = UEFA Uluslar Ligi         15 = FIFA Kulüpler Dünya Kupası
//    32 = Dünya Kupası Elemeleri (Avrupa)
export const ALLOWED_LEAGUE_IDS = new Set([203, 2, 3, 848, 531, 1, 4, 5, 15, 32]);

function isAllowed(match) {
  return ALLOWED_LEAGUE_IDS.has(Number(match.competition?.id));
}

export async function getMatchesByDate(date) {
  // Geçmiş günler değişmez → çok uzun cache; bugün/gelecek → kısa. (Tek istek,
  // tüm ligleri getirir; sonra izinli liglere göre filtreleriz.)
  const ttlMs = date < todayUtc() ? TTL.matchesPast : TTL.matchesToday;

  // Upstream API hatası (kota, askıya alınmış hesap, ağ) manuel maçları
  // engellememeli — admin tam da API çalışmadığında elle maç girer. Hata
  // durumunda manuel maçlarla devam ederiz; gösterecek manuel maç da yoksa
  // hatayı olduğu gibi iletiriz.
  let matches = [];
  let apiError = null;
  try {
    const data = await apiGet(`/fixtures?date=${date}`, { ttlMs });
    matches = (data.response ?? []).map(N.normalizeFixture).filter(isAllowed);
  } catch (err) {
    apiError = err;
  }

  // Admin'in elle girdiği maçlar (lig filtresine takılmaz) aynı gruplara katılır.
  const manual = (await listManualMatchesByDate(date)).map(N.manualToMatch);
  if (apiError && manual.length === 0) throw apiError;

  const groups = { live: [], upcoming: [], finished: [], other: [] };
  for (const m of matches) groups[m.statusGroup].push(m);
  for (const m of manual) groups[m.statusGroup].push(m);

  const byKickoff = (a, b) => new Date(a.utcDate) - new Date(b.utcDate);
  for (const k of Object.keys(groups)) groups[k].sort(byKickoff);

  return {
    date,
    count: matches.length + manual.length,
    apiDegraded: Boolean(apiError),
    ...groups,
  };
}

/** İleri tarihli manuel maçlar (API'den bağımsız; ana sayfa "özel maçlar"). */
export async function getUpcomingManualMatches() {
  return (await listUpcomingManualMatches()).map(N.manualToMatch);
}

export async function getMatch(id) {
  if (isManualId(id)) {
    const row = await getManualMatchRow(id);
    if (!row) throw new ApiError(404, 'Maç bulunamadı.');
    return N.manualToMatch(row);
  }
  const data = await apiGet(`/fixtures?id=${id}`, { ttlMs: TTL.matchDetail });
  const item = data.response?.[0];
  if (!item) throw new ApiError(404, 'Maç bulunamadı.');
  return N.normalizeFixture(item);
}

export async function getMatchEvents(id) {
  if (isManualId(id)) {
    const row = await getManualMatchRow(id);
    if (!row) throw new ApiError(404, 'Maç bulunamadı.');
    return N.manualEventsToClient(await listManualEvents(id), row.home_name, row.away_name);
  }
  const data = await apiGet(`/fixtures/events?fixture=${id}`, { ttlMs: TTL.events });
  return N.normalizeEvents(data.response);
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

/** Bir maçın kadrosundaki geçerli oyuncu ID'leri (puanlama doğrulaması için). */
export async function getMatchPlayerIds(id) {
  try {
    const { home, away } = await getMatchLineups(id);
    const ids = new Set();
    for (const team of [home, away]) {
      for (const p of [...(team?.startXI ?? []), ...(team?.substitutes ?? [])]) {
        if (p?.id != null) ids.add(Number(p.id));
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}
