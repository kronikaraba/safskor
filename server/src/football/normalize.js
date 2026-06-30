// API-Football (v3) yanitlarini istemcinin bekledigi sade sekle cevirir.

const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FINISHED = new Set(['FT', 'AET', 'PEN', 'WO', 'AWD']);
const UPCOMING = new Set(['NS', 'TBD']);

export const STATUS_LABEL = {
  TBD: 'Planlandi',
  NS: 'Planlandi',
  '1H': '1. yari',
  '2H': '2. yari',
  HT: 'Devre arasi',
  ET: 'Uzatma',
  BT: 'Ara',
  P: 'Penaltilar',
  LIVE: 'Canli',
  INT: 'Durduruldu',
  FT: 'Bitti',
  AET: 'Bitti (uzatma)',
  PEN: 'Bitti (penalti)',
  PST: 'Ertelendi',
  CANC: 'Iptal',
  ABD: 'Tatil edildi',
  SUSP: 'Askida',
  WO: 'Hukmen',
  AWD: 'Tescil',
};

export function statusGroup(short) {
  if (LIVE.has(short)) return 'live';
  if (FINISHED.has(short)) return 'finished';
  if (UPCOMING.has(short)) return 'upcoming';
  return 'other';
}

// --- Sofascore (RapidAPI) → istemci şekli ---

const SOFA_TEAM_CREST = (id) =>
  id ? `https://api.sofascore.app/api/v1/team/${id}/image` : null;
const SOFA_LEAGUE_CREST = (id) =>
  id ? `https://api.sofascore.app/api/v1/unique-tournament/${id}/image` : null;

function sofaTeamRef(t) {
  if (!t) return null;
  return {
    id: t.id ?? null,
    name: t.name ?? 'Bilinmiyor',
    shortName: t.shortName ?? t.name ?? '',
    crest: SOFA_TEAM_CREST(t.id),
  };
}

// Sofascore status.description (İngilizce) → Türkçe etiket.
const SOFA_DESC_LABEL = {
  'Not started': 'Planlandı',
  '1st half': '1. yarı',
  Halftime: 'Devre arası',
  '2nd half': '2. yarı',
  'Extra time': 'Uzatma',
  Penalties: 'Penaltılar',
  'Awaiting extra time': 'Uzatma bekleniyor',
  'Awaiting penalties': 'Penaltı bekleniyor',
  Ended: 'Bitti',
  'AET': 'Bitti (uzatma)',
  'AP': 'Bitti (penaltı)',
  Postponed: 'Ertelendi',
  Canceled: 'İptal',
  Interrupted: 'Durduruldu',
  Suspended: 'Askıda',
};

function sofaGroup(type) {
  if (type === 'inprogress') return 'live';
  if (type === 'finished') return 'finished';
  if (type === 'notstarted') return 'upcoming';
  return 'other'; // postponed, canceled, suspended...
}

// Canlı maçta yaklaşık dakika hesabı (Sofascore dakika alanı vermez).
function sofaMinute(event, group) {
  if (group !== 'live') return null;
  const desc = event.status?.description ?? '';
  const startTs = event.time?.currentPeriodStartTimestamp;
  if (!startTs) {
    if (/halftime/i.test(desc)) return 45;
    return null;
  }
  const elapsed = Math.floor((Date.now() / 1000 - startTs) / 60);
  if (/2nd half/i.test(desc)) return 45 + Math.max(0, elapsed) + 1;
  if (/halftime/i.test(desc)) return 45;
  if (/1st half/i.test(desc)) return Math.max(0, elapsed) + 1;
  if (/extra/i.test(desc)) return 90 + Math.max(0, elapsed) + 1;
  return null;
}

export function normalizeFixture(event) {
  const type = event.status?.type ?? 'notstarted';
  const group = sofaGroup(type);
  const desc = event.status?.description ?? '';
  const label = SOFA_DESC_LABEL[desc] ?? desc ?? '';

  // winnerCode: 1 = ev, 2 = deplasman, 3 = beraberlik
  let winner = null;
  if (event.winnerCode === 1) winner = 'HOME_TEAM';
  else if (event.winnerCode === 2) winner = 'AWAY_TEAM';
  else if (event.winnerCode === 3) winner = 'DRAW';
  else if (group === 'finished') winner = 'DRAW';

  const ut = event.tournament?.uniqueTournament;

  return {
    id: event.id,
    utcDate: event.startTimestamp ? new Date(event.startTimestamp * 1000).toISOString() : null,
    status: type,
    statusGroup: group,
    statusLabel: label || (group === 'upcoming' ? 'Planlandı' : ''),
    minute: sofaMinute(event, group),
    matchday: event.roundInfo?.round ?? null,
    stage: event.roundInfo?.round ? `${event.roundInfo.round}. hafta` : null,
    competition: {
      id: ut?.id ?? null,
      name: ut?.name ?? event.tournament?.name ?? '',
      emblem: SOFA_LEAGUE_CREST(ut?.id),
      country: event.tournament?.category?.country?.name ?? event.tournament?.category?.name ?? null,
      season: event.season?.id ?? null,
      flag: null,
    },
    homeTeam: sofaTeamRef(event.homeTeam),
    awayTeam: sofaTeamRef(event.awayTeam),
    score: {
      home: event.homeScore?.current ?? null,
      away: event.awayScore?.current ?? null,
      halfTime: { home: event.homeScore?.period1 ?? null, away: event.awayScore?.period1 ?? null },
      winner,
      duration: null,
    },
    venue: event.venue?.stadium?.name ?? null,
    isLive: group === 'live',
    isFinished: group === 'finished',
    canRate: group === 'live',
  };
}

const POS_LABEL = { G: 'Kaleci', D: 'Defans', M: 'Orta saha', F: 'Forvet' };

export function parseGrid(grid, pos, idx) {
  if (grid && /^\d+:\d+$/.test(grid)) {
    const [row, col] = grid.split(':').map(Number);
    return { row, col };
  }
  const row = pos === 'G' ? 1 : pos === 'D' ? 2 : pos === 'M' ? 3 : 4;
  return { row, col: idx + 1 };
}

function mapPlayer(p, idx) {
  const { row, col } = parseGrid(p?.grid, p?.pos, idx);
  return {
    id: p?.id ?? null,
    name: p?.name ?? '',
    number: p?.number ?? null,
    pos: p?.pos ?? null,
    posLabel: POS_LABEL[p?.pos] ?? (p?.pos || ''),
    grid: p?.grid ?? null,
    row,
    col,
  };
}

// Sofascore lineups: { confirmed, home:{ players:[{player, position, substitute, shirtNumber}], formation }, away:{...} }
function sofaPlayer(entry, idx) {
  const p = entry.player ?? {};
  return mapPlayer(
    {
      id: p.id ?? null,
      name: p.name ?? '',
      number: entry.shirtNumber ?? (p.jerseyNumber != null ? Number(p.jerseyNumber) : null),
      pos: entry.position ?? p.position ?? null,
      grid: null,
    },
    idx
  );
}

export function normalizeLineup(sideData, teamRef) {
  const players = sideData?.players ?? [];
  const starters = players.filter((e) => !e.substitute);
  const subs = players.filter((e) => e.substitute);
  return {
    teamId: teamRef?.id ?? null,
    teamName: teamRef?.name ?? '',
    crest: teamRef?.crest ?? null,
    colors: null,
    formation: sideData?.formation ?? null,
    coach: sideData?.coach?.name ?? null,
    startXI: starters.map((e, i) => sofaPlayer(e, i)),
    substitutes: subs.map((e, i) => sofaPlayer(e, i)),
  };
}

// Sofascore incidents → istemci olay şekli. homeTeam/awayTeam isim/teamId için.
export function normalizeEvents(incidents, homeTeam, awayTeam) {
  return (incidents ?? [])
    .filter((e) => ['goal', 'card', 'substitution'].includes(e.incidentType))
    .map((e) => {
      const minute = e.time ?? null;
      const extra = e.addedTime && e.addedTime !== 999 ? e.addedTime : null;
      const side = e.isHome ? homeTeam : awayTeam;
      const teamId = side?.id ?? null;
      const teamName = side?.name ?? null;

      if (e.incidentType === 'goal') {
        const cls = (e.incidentClass || '').toLowerCase();
        const detail = cls.includes('penalty') ? 'PENALTY' : cls.includes('own') ? 'OWN' : 'REGULAR';
        return {
          type: 'goal',
          minute,
          extra,
          teamId,
          teamName,
          player: e.player?.name ?? null,
          playerId: e.player?.id ?? null,
          assist: e.assist1?.name ?? null,
          detail,
        };
      }
      if (e.incidentType === 'card') {
        const cls = (e.incidentClass || '').toLowerCase();
        const red = cls.includes('red');
        return {
          type: red ? 'red_card' : 'yellow_card',
          minute,
          extra,
          teamId,
          teamName,
          player: e.player?.name ?? e.playerName ?? null,
          playerId: e.player?.id ?? null,
        };
      }
      // substitution: playerIn girer, playerOut çıkar
      return {
        type: 'substitution',
        minute,
        extra,
        teamId,
        teamName,
        player: e.playerIn?.name ?? null,
        playerId: e.playerIn?.id ?? null,
        playerOut: e.playerOut?.name ?? null,
      };
    })
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999) || (a.extra ?? 0) - (b.extra ?? 0));
}

// --- Manuel maçlar (admin elle girer) → API maçlarıyla aynı şekil ---

function toIsoDate(v) {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** manual_matches satırını normalizeFixture ile aynı şekle çevirir. */
export function manualToMatch(row) {
  const short = row.status ?? 'NS';
  const group = statusGroup(short);

  const hs = row.home_score;
  const as = row.away_score;
  let winner = null;
  if (group === 'finished') {
    if (hs > as) winner = 'HOME_TEAM';
    else if (as > hs) winner = 'AWAY_TEAM';
    else winner = 'DRAW';
  }

  return {
    id: Number(row.id),
    utcDate: toIsoDate(row.kickoff),
    status: short,
    statusGroup: group,
    statusLabel: STATUS_LABEL[short] ?? short,
    minute: row.minute ?? null,
    matchday: null,
    stage: row.stage ?? null,
    competition: {
      id: null,
      name: row.competition ?? '',
      emblem: null,
      country: null,
      season: null,
      flag: null,
    },
    homeTeam: { id: null, name: row.home_name ?? 'Bilinmiyor', shortName: row.home_name ?? '', crest: null },
    awayTeam: { id: null, name: row.away_name ?? 'Bilinmiyor', shortName: row.away_name ?? '', crest: null },
    score: {
      home: hs ?? null,
      away: as ?? null,
      halfTime: { home: row.ht_home ?? null, away: row.ht_away ?? null },
      winner,
      duration: null,
    },
    venue: row.venue ?? null,
    isLive: group === 'live',
    isFinished: group === 'finished',
    canRate: group === 'live',
    isManual: true,
  };
}

/** Bir takımın manuel kadro satırlarını {teamId, startXI, substitutes,...} şekline çevirir. */
export function manualLineupTeam(rows, teamName) {
  const toPlayer = (r, idx) =>
    mapPlayer({ id: Number(r.id), name: r.name, number: r.number, pos: r.pos, grid: null }, idx);
  return {
    teamId: null,
    teamName: teamName ?? '',
    crest: null,
    colors: null,
    formation: null,
    coach: null,
    startXI: rows.filter((r) => r.is_starter).map(toPlayer),
    substitutes: rows.filter((r) => !r.is_starter).map(toPlayer),
  };
}

/** manual_events satırlarını istemcinin beklediği olay şekline çevirir. */
export function manualEventsToClient(rows, homeName, awayName) {
  return (rows ?? []).map((e) => ({
    type: e.type,
    minute: e.minute ?? null,
    extra: null,
    teamId: null,
    teamName: e.side === 'home' ? homeName : awayName,
    player: e.player ?? null,
    playerId: null,
    assist: null,
    playerOut: e.player_out ?? null,
    detail: e.detail ?? null,
  }));
}

// Sofascore standings: { standings: [ { name, tournament, rows: [ { team, position, matches, wins, draws, losses, scoresFor, scoresAgainst, points } ] } ] }
export function normalizeStandings(standings) {
  const list = Array.isArray(standings) ? standings : [];
  if (list.length === 0) return { competition: null, season: null, groups: [] };

  const first = list[0];
  const ut = first.tournament?.uniqueTournament ?? first.tournament;

  const groups = list.map((tbl) => ({
    group: list.length > 1 ? tbl.name ?? null : null,
    table: (tbl.rows ?? []).map((r) => ({
      position: r.position,
      teamId: r.team?.id ?? null,
      teamName: r.team?.name ?? '',
      crest: r.team?.id ? `https://api.sofascore.app/api/v1/team/${r.team.id}/image` : null,
      playedGames: r.matches ?? 0,
      won: r.wins ?? 0,
      draw: r.draws ?? 0,
      lost: r.losses ?? 0,
      points: r.points ?? 0,
      goalsFor: r.scoresFor ?? 0,
      goalsAgainst: r.scoresAgainst ?? 0,
      goalDifference: (r.scoresFor ?? 0) - (r.scoresAgainst ?? 0),
      form: null,
    })),
  }));

  return {
    competition: {
      id: ut?.id ?? null,
      name: ut?.name ?? first.tournament?.name ?? '',
      emblem: ut?.id ? `https://api.sofascore.app/api/v1/unique-tournament/${ut.id}/image` : null,
    },
    season: { currentMatchday: null },
    groups,
  };
}
