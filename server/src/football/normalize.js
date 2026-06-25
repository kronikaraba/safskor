// API-Football (v3) yanitlarini istemcinin bekledigi sade sekle cevirir.

const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
const FINISHED = new Set(['FT', 'AET', 'PEN', 'WO', 'AWD']);
const UPCOMING = new Set(['NS', 'TBD']);

const STATUS_LABEL = {
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

function teamRef(t) {
  if (!t) return null;
  return {
    id: t.id ?? null,
    name: t.name ?? 'Bilinmiyor',
    shortName: t.name ?? '',
    crest: t.logo ?? null,
  };
}

export function normalizeFixture(item) {
  const { fixture, league, teams, goals, score } = item;
  const short = fixture.status?.short ?? 'NS';
  const group = statusGroup(short);

  let winner = null;
  if (teams?.home?.winner === true) winner = 'HOME_TEAM';
  else if (teams?.away?.winner === true) winner = 'AWAY_TEAM';
  else if (group === 'finished') winner = 'DRAW';

  return {
    id: fixture.id,
    utcDate: fixture.date ?? null,
    status: short,
    statusGroup: group,
    statusLabel: STATUS_LABEL[short] ?? short,
    minute: fixture.status?.elapsed ?? null,
    matchday: null,
    stage: league?.round ?? null,
    competition: {
      id: league?.id ?? null,
      name: league?.name ?? '',
      emblem: league?.logo ?? null,
      country: league?.country ?? null,
      season: league?.season ?? null,
      flag: league?.flag ?? null,
    },
    homeTeam: teamRef(teams?.home),
    awayTeam: teamRef(teams?.away),
    score: {
      home: goals?.home ?? null,
      away: goals?.away ?? null,
      halfTime: { home: score?.halftime?.home ?? null, away: score?.halftime?.away ?? null },
      winner,
      duration: null,
    },
    venue: fixture.venue?.name ?? null,
    isLive: group === 'live',
    isFinished: group === 'finished',
    canRate: group === 'live',
  };
}

const POS_LABEL = { G: 'Kaleci', D: 'Defans', M: 'Orta saha', F: 'Forvet' };

function parseGrid(grid, pos, idx) {
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

export function normalizeLineup(team) {
  return {
    teamId: team.team?.id ?? null,
    teamName: team.team?.name ?? '',
    crest: team.team?.logo ?? null,
    colors: team.team?.colors ?? null,
    formation: team.formation ?? null,
    coach: team.coach?.name ?? null,
    startXI: (team.startXI ?? []).map((e, i) => mapPlayer(e.player, i)),
    substitutes: (team.substitutes ?? []).map((e, i) => mapPlayer(e.player, i)),
  };
}

export function normalizeEvents(events) {
  return (events ?? [])
    .map((e) => {
      const minute = e.time?.elapsed ?? null;
      const extra = e.time?.extra ?? null;
      const teamId = e.team?.id ?? null;
      const teamName = e.team?.name ?? null;

      if (e.type === 'Goal') {
        const detail = /penalty/i.test(e.detail || '')
          ? 'PENALTY'
          : /own/i.test(e.detail || '')
            ? 'OWN'
            : 'REGULAR';
        return {
          type: 'goal',
          minute,
          extra,
          teamId,
          teamName,
          player: e.player?.name ?? null,
          playerId: e.player?.id ?? null,
          assist: e.assist?.name ?? null,
          detail,
        };
      }
      if (e.type === 'Card') {
        const red = /red/i.test(e.detail || '');
        return {
          type: red ? 'red_card' : 'yellow_card',
          minute,
          extra,
          teamId,
          teamName,
          player: e.player?.name ?? null,
          playerId: e.player?.id ?? null,
        };
      }
      if (e.type === 'subst') {
        // API-Football: player = cikan, assist = giren (gercek veriyle dogrulandi)
        return {
          type: 'substitution',
          minute,
          extra,
          teamId,
          teamName,
          player: e.assist?.name ?? null,
          playerId: e.assist?.id ?? null,
          playerOut: e.player?.name ?? null,
        };
      }
      return {
        type: e.type === 'Var' ? 'var' : 'other',
        minute,
        extra,
        teamId,
        teamName,
        player: e.player?.name ?? null,
        detail: e.detail ?? null,
      };
    })
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999) || (a.extra ?? 0) - (b.extra ?? 0));
}

export function normalizeStandings(response) {
  const lg = response?.[0]?.league;
  if (!lg) return { competition: null, season: null, groups: [] };
  const groups = (lg.standings ?? []).map((tbl) => ({
    group: tbl[0]?.group ?? null,
    table: (tbl ?? []).map((r) => ({
      position: r.rank,
      teamId: r.team?.id ?? null,
      teamName: r.team?.name ?? '',
      crest: r.team?.logo ?? null,
      playedGames: r.all?.played ?? 0,
      won: r.all?.win ?? 0,
      draw: r.all?.draw ?? 0,
      lost: r.all?.lose ?? 0,
      points: r.points ?? 0,
      goalsFor: r.all?.goals?.for ?? 0,
      goalsAgainst: r.all?.goals?.against ?? 0,
      goalDifference: r.goalsDiff ?? 0,
      form: r.form ?? null,
    })),
  }));
  return {
    competition: { id: lg.id, name: lg.name, emblem: lg.logo ?? null },
    season: { currentMatchday: null },
    groups,
  };
}
