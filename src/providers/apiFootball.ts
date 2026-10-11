import type { FootballProvider, Lineup, Match, MatchEvent, MatchStatus, MatchSummary, Player, StatLine, Side } from '../types.js';

/**
 * API-Football (api-sports.io) v3 adaptörü.
 * Anahtar yalnızca sunucuda, istek başlığında kullanılır.
 */
export class ApiFootballProvider implements FootballProvider {
  readonly name = 'api-football';
  readonly isDemo = false;
  readonly pollMs: { list: number; detail: number };

  constructor(
    private opts: { key: string; baseUrl: string; leagues: string[]; listPollMs: number; detailPollMs: number },
  ) {
    this.pollMs = { list: opts.listPollMs, detail: opts.detailPollMs };
  }

  private async get(path: string, params: Record<string, string>): Promise<any[]> {
    const url = new URL(this.opts.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { 'x-apisports-key': this.opts.key };
    if (url.hostname.includes('rapidapi')) {
      headers['x-rapidapi-key'] = this.opts.key;
      headers['x-rapidapi-host'] = url.hostname;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
    const body: any = await res.json();
    const errors = body.errors && (Array.isArray(body.errors) ? body.errors : Object.values(body.errors));
    if (errors && errors.length) throw new Error(`API-Football: ${JSON.stringify(body.errors)}`);
    return body.response ?? [];
  }

  async listMatches(): Promise<MatchSummary[]> {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    const rows = await this.get('/fixtures', { date: today, timezone: 'Europe/Istanbul' });
    const leagues = new Set(this.opts.leagues);
    return rows.filter((r) => !leagues.size || leagues.has(String(r.league?.id))).map(toSummary);
  }

  async getMatch(id: string): Promise<Match | null> {
    const rows = await this.get('/fixtures', { id, timezone: 'Europe/Istanbul' });
    if (!rows.length) return null;
    return toMatch(rows[0]);
  }
}

const LIVE = new Set(['1H', '2H', 'ET', 'P', 'LIVE', 'BT', 'INT']);
const DONE = new Set(['FT', 'AET', 'PEN']);
const OFF = new Set(['PST', 'CANC', 'ABD', 'SUSP', 'AWD', 'WO']);

function mapStatus(short: string): MatchStatus {
  if (short === 'HT') return 'HT';
  if (LIVE.has(short)) return 'LIVE';
  if (DONE.has(short)) return 'FT';
  if (OFF.has(short)) return 'POSTPONED';
  return 'SCHEDULED';
}

function toSummary(r: any): MatchSummary {
  const t = (x: any) => ({ id: String(x.id), name: x.name, short: abbreviate(x.name), logo: x.logo });
  return {
    id: String(r.fixture.id),
    competition: { name: r.league?.name, country: r.league?.country, logo: r.league?.logo, round: r.league?.round },
    status: mapStatus(r.fixture.status?.short),
    minute: r.fixture.status?.elapsed ?? null,
    extra: r.fixture.status?.extra ?? null,
    kickoff: r.fixture.date,
    venue: r.fixture.venue?.name ?? undefined,
    home: t(r.teams.home),
    away: t(r.teams.away),
    score: { home: r.goals?.home ?? 0, away: r.goals?.away ?? 0 },
  };
}

function toMatch(r: any): Match {
  const base = toSummary(r);
  const sideOf = (teamId: any): Side => (String(teamId) === base.home.id ? 'home' : 'away');

  const events: MatchEvent[] = (r.events ?? []).map((e: any, i: number) => {
    const detail: string = e.detail ?? '';
    let type: MatchEvent['type'] = 'var';
    if (e.type === 'Goal') type = detail === 'Own Goal' ? 'own_goal' : detail === 'Penalty' ? 'penalty' : detail === 'Missed Penalty' ? 'missed_penalty' : 'goal';
    else if (e.type === 'Card') type = /Red/i.test(detail) ? 'red' : 'yellow';
    else if (/subst/i.test(e.type)) type = 'sub';
    return {
      id: `${base.id}-${i}`,
      minute: e.time?.elapsed ?? 0,
      extra: e.time?.extra ?? undefined,
      type,
      side: sideOf(e.team?.id),
      player: e.player?.name ?? undefined,
      playerId: e.player?.id ? String(e.player.id) : undefined,
      related: e.assist?.name ?? undefined,
      relatedId: e.assist?.id ? String(e.assist.id) : undefined,
      detail,
    };
  });

  // Oyuncu istatistikleri: players[].players[].statistics[0]
  const pstats = new Map<string, any>();
  for (const team of r.players ?? []) {
    for (const p of team.players ?? []) {
      const s = p.statistics?.[0] ?? {};
      pstats.set(String(p.player.id), {
        rating: s.games?.rating ? Number(s.games.rating) : undefined,
        minutes: s.games?.minutes ?? undefined,
        goals: s.goals?.total ?? 0,
        assists: s.goals?.assists ?? 0,
        shots: s.shots?.total ?? 0,
        passes: s.passes?.total ?? 0,
        yellow: s.cards?.yellow ?? 0,
        red: s.cards?.red ?? 0,
      });
    }
  }

  const toPlayer = (x: any): Player => ({
    id: String(x.player.id),
    name: x.player.name,
    number: x.player.number ?? undefined,
    pos: x.player.pos ?? undefined,
    grid: x.player.grid ?? undefined,
    stats: pstats.get(String(x.player.id)),
  });

  let lineups: Match['lineups'];
  if (Array.isArray(r.lineups) && r.lineups.length === 2) {
    const byside: Partial<Record<Side, Lineup>> = {};
    for (const l of r.lineups) {
      byside[sideOf(l.team?.id)] = {
        formation: l.formation ?? undefined,
        coach: l.coach?.name ?? undefined,
        startXI: (l.startXI ?? []).map(toPlayer),
        subs: (l.substitutes ?? []).map(toPlayer),
      };
    }
    if (byside.home && byside.away) lineups = { home: byside.home, away: byside.away };
  }

  const stats: StatLine[] = [];
  if (Array.isArray(r.statistics) && r.statistics.length === 2) {
    const get = (side: Side, type: string) => {
      const t = r.statistics.find((s: any) => sideOf(s.team?.id) === side);
      const v = t?.statistics?.find((s: any) => s.type === type)?.value;
      if (v == null) return null;
      return typeof v === 'string' ? parseFloat(v) : Number(v);
    };
    for (const [type, key, label, unit] of STAT_MAP) {
      const h = get('home', type);
      const a = get('away', type);
      if (h == null && a == null) continue;
      stats.push({ key, label, home: h ?? 0, away: a ?? 0, ...(unit ? { unit } : {}) });
    }
  }

  return { ...base, events, lineups, stats };
}

const STAT_MAP: [string, string, string, '%' | undefined][] = [
  ['Ball Possession', 'possession', 'Topla oynama', '%'],
  ['expected_goals', 'xg', 'Gol beklentisi (xG)', undefined],
  ['Total Shots', 'shots', 'Toplam şut', undefined],
  ['Shots on Goal', 'shotsOnTarget', 'İsabetli şut', undefined],
  ['Corner Kicks', 'corners', 'Korner', undefined],
  ['Fouls', 'fouls', 'Faul', undefined],
  ['Offsides', 'offsides', 'Ofsayt', undefined],
  ['Yellow Cards', 'yellow', 'Sarı kart', undefined],
  ['Red Cards', 'red', 'Kırmızı kart', undefined],
  ['Goalkeeper Saves', 'saves', 'Kurtarış', undefined],
  ['Total passes', 'passes', 'Pas', undefined],
  ['Passes %', 'passAcc', 'Pas isabeti', '%'],
];

function abbreviate(name: string): string {
  const words = name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return name.slice(0, 3).toUpperCase();
}
