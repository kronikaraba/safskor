import type { FootballProvider, Lineup, Match, MatchEvent, MatchStatus, MatchSummary, Player, StatLine, Side } from '../types.js';

/** Günlük istek hakkı bitti; gün dönümüne (00:00 UTC) kadar istek atılmaz. */
export class QuotaError extends Error {
  readonly kind = 'quota';
}
/** Anahtar geçersiz ya da plan bu veriye (ör. güncel sezon) izin vermiyor; tekrar denemek boşuna. */
export class PlanError extends Error {
  readonly kind = 'plan';
}

export interface QuotaInfo {
  limit: number;
  used: number;
  remaining: number | null;
  reserve: number;
  resetsAt: string;
}

type Opts = {
  key: string;
  baseUrl: string;
  leagues: string[];
  listPollMs: number;
  listIdlePollMs: number;
  detailPollMs: number;
  livePollMs: number;
  dailyLimit: number;
  reserve: number;
  /** Bu takımların maçları, lig listesinde olmasa da (kupa, Avrupa) listelenir */
  focusTeams?: string[];
};

/**
 * API-Football (api-sports.io) v3 adaptörü.
 * Anahtar yalnızca sunucuda, istek başlığında kullanılır.
 * Günlük kotayı izler: API'nin bildirdiği kalan hakkı (x-ratelimit-requests-remaining) ve kendi sayacını kullanır,
 * yedek sınırına gelince istek atmayı bırakır.
 */
export class ApiFootballProvider implements FootballProvider {
  readonly name = 'api-football';
  readonly isDemo = false;
  private day = utcDay();
  private used = 0;
  private remaining: number | null = null;
  private busy = false; // son listede canlı ya da yakında başlayacak maç var mı
  /** Öncelikli takımların, takip listesi dışındaki ligleri (canlı akışa eklenir) */
  private extraLeagues = new Set<string>();

  constructor(private opts: Opts) {}

  get pollMs() {
    return { list: this.busy ? this.opts.listPollMs : this.opts.listIdlePollMs, detail: this.opts.detailPollMs, live: this.opts.livePollMs };
  }

  quota(): QuotaInfo {
    this.rollDay();
    return { limit: this.opts.dailyLimit, used: this.used, remaining: this.remaining, reserve: this.opts.reserve, resetsAt: nextUtcMidnight().toISOString() };
  }

  private rollDay() {
    const d = utcDay();
    if (d !== this.day) {
      this.day = d;
      this.used = 0;
      this.remaining = null;
    }
  }

  private exhausted() {
    this.rollDay();
    const left = this.remaining ?? this.opts.dailyLimit - this.used;
    return left <= this.opts.reserve;
  }

  private async get(path: string, params: Record<string, string>): Promise<any[]> {
    if (this.exhausted()) throw new QuotaError('Günlük API kotası doldu');
    const url = new URL(this.opts.baseUrl.replace(/\/$/, '') + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { 'x-apisports-key': this.opts.key };
    if (url.hostname.includes('rapidapi')) {
      headers['x-rapidapi-key'] = this.opts.key;
      headers['x-rapidapi-host'] = url.hostname;
    }
    this.used++;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const rem = res.headers.get('x-ratelimit-requests-remaining');
    if (rem != null && rem !== '' && !Number.isNaN(Number(rem))) this.remaining = Number(rem);
    if (res.status === 429) {
      // günlük hak gerçekten bittiyse kota hatası; değilse dakikalık sınır: geçici hata olarak kısa süre sonra tekrar dene
      if (this.remaining === 0) throw new QuotaError('Günlük API kotası doldu (HTTP 429)');
      throw new Error('API-Football dakikalık istek sınırı (HTTP 429)');
    }
    if (res.status === 401 || res.status === 403) throw new PlanError(`API-Football HTTP ${res.status}`);
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
    const body: any = await res.json();
    const errs = body.errors && !Array.isArray(body.errors) ? body.errors : null;
    if (errs && Object.keys(errs).length) {
      const text = Object.values(errs).join(' ');
      if (errs.requests || errs.rateLimit) {
        if (errs.requests) this.remaining = 0;
        throw new QuotaError(`API-Football: ${text}`);
      }
      if (errs.token || errs.plan || errs.access) throw new PlanError(`API-Football: ${text}`);
      throw new Error(`API-Football: ${text}`);
    }
    if (Array.isArray(body.errors) && body.errors.length) throw new Error(`API-Football: ${JSON.stringify(body.errors)}`);
    return body.response ?? [];
  }

  async listMatches(): Promise<MatchSummary[]> {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    const rows = await this.get('/fixtures', { date: today, timezone: 'Europe/Istanbul' });
    const leagues = new Set(this.opts.leagues);
    const focus = new Set(this.opts.focusTeams ?? []);
    const isFocus = (r: any) => focus.has(String(r.teams?.home?.id)) || focus.has(String(r.teams?.away?.id));
    // tarih sorgusu zaten tüm maçları getirir: öncelikli takımların kupa/Avrupa maçları ek istek olmadan listeye girer
    const picked = rows.filter((r) => !leagues.size || leagues.has(String(r.league?.id)) || isFocus(r));
    this.extraLeagues = new Set(picked.filter((r) => leagues.size && !leagues.has(String(r.league?.id))).map((r) => String(r.league?.id)));
    const list = picked.map(toSummary);
    const soon = Date.now() + 30 * 60_000;
    this.busy = list.some((m) => m.status === 'LIVE' || m.status === 'HT' || (m.status === 'SCHEDULED' && Date.parse(m.kickoff) <= soon));
    return list;
  }

  /** Takip edilen liglerde oynanan tüm maçlar tek istekte (olaylar dahil, kadro/istatistik hariç) */
  async liveMatches(): Promise<Match[]> {
    const live = this.opts.leagues.length ? [...new Set([...this.opts.leagues, ...this.extraLeagues])].join('-') : 'all';
    const rows = await this.get('/fixtures', { live, timezone: 'Europe/Istanbul' });
    return rows.map(toMatch);
  }

  async getMatch(id: string): Promise<Match | null> {
    const rows = await this.get('/fixtures', { id, timezone: 'Europe/Istanbul' });
    if (!rows.length) return null;
    return toMatch(rows[0]);
  }
}

const utcDay = () => new Date().toISOString().slice(0, 10);
function nextUtcMidnight() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
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
