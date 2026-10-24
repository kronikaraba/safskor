import type { AbsentPlayer, FootballProvider, MatchPreview, ProbableXI, TeamFixtures, TeamProfile, Standings, Lineup, Match, MatchEvent, MatchStatus, MatchSummary, Player, StatLine, Side } from '../types.js';

/** Günlük istek hakkı bitti; gün dönümüne (00:00 UTC) kadar istek atılmaz. */
export class QuotaError extends Error {
  readonly kind = 'quota';
}
/** Dakikalık istek sınırı (HTTP 429): geçici; bir dakika beklenir, site demoya geçmez. */
export class RateError extends Error {
  readonly kind = 'rate';
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

  /** dakikalık sınıra takılınca bu zamana kadar istek atılmaz */
  private pauseUntil = 0;

  private async get(path: string, params: Record<string, string>): Promise<any[]> {
    if (this.exhausted()) throw new QuotaError('Günlük API kotası doldu');
    if (Date.now() < this.pauseUntil) throw new RateError('API-Football dakikalık istek sınırı; kısa bir mola');
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
      this.pauseUntil = Date.now() + 65_000;
      throw new RateError('API-Football dakikalık istek sınırı (HTTP 429)');
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

  /** Bir günün (İstanbul saatiyle) takip edilen liglerdeki ve öncelikli takımların maçları; tek istek */
  private async dayFixtures(date: string): Promise<any[]> {
    const rows = await this.get('/fixtures', { date, timezone: 'Europe/Istanbul' });
    const leagues = new Set(this.opts.leagues);
    const focus = new Set(this.opts.focusTeams ?? []);
    const isFocus = (r: any) => focus.has(String(r.teams?.home?.id)) || focus.has(String(r.teams?.away?.id));
    // tarih sorgusu zaten tüm maçları getirir: öncelikli takımların kupa/Avrupa maçları ek istek olmadan listeye girer
    return rows.filter((r) => !leagues.size || leagues.has(String(r.league?.id)) || isFocus(r));
  }

  async listMatches(): Promise<MatchSummary[]> {
    const leagues = new Set(this.opts.leagues);
    const picked = await this.dayFixtures(istanbulDay(0));
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

  /** Yarının maçları (tek istek; seyrek çağrılır) */
  async tomorrowMatches(): Promise<MatchSummary[]> {
    const rows = await this.dayFixtures(istanbulDay(1));
    return rows.map(toSummary).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }

  /** Dünün maçları (tek istek; günde bir kez çağrılır) */
  async yesterdayMatches(): Promise<MatchSummary[]> {
    const rows = await this.dayFixtures(istanbulDay(-1));
    return rows.map(toSummary).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }

  /** Ligin güncel sezon puan durumu (tek istek) */
  async standings(leagueId: string): Promise<Standings | null> {
    const now = new Date();
    // Avrupa ligleri yaz ortasında başlar: Temmuz'dan itibaren yeni sezon
    const season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const rows = await this.get('/standings', { league: leagueId, season: String(season) });
    const l = rows[0]?.league;
    const table: any[] = l?.standings?.[0] ?? [];
    if (!table.length) return null;
    const t = (x: any) => ({ id: String(x.id), name: x.name, short: abbreviate(x.name), logo: x.logo });
    return {
      league: { id: String(l.id), name: l.name, country: trCountry(l.country, l.name), logo: l.logo, season: l.season ?? season },
      rows: table.map((r) => ({
        rank: r.rank,
        team: t(r.team),
        points: r.points ?? 0,
        played: r.all?.played ?? 0,
        win: r.all?.win ?? 0,
        draw: r.all?.draw ?? 0,
        lose: r.all?.lose ?? 0,
        goalsFor: r.all?.goals?.for ?? 0,
        goalsAgainst: r.all?.goals?.against ?? 0,
        goalsDiff: r.goalsDiff ?? 0,
        form: r.form ?? undefined,
        description: r.description ?? undefined,
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Takımın bir sonraki ve son maçı (iki istek; seyrek çağrılır) */
  async teamFixtures(teamId: string): Promise<TeamFixtures> {
    const next = await this.get('/fixtures', { team: teamId, next: '1', timezone: 'Europe/Istanbul' });
    const last = await this.get('/fixtures', { team: teamId, last: '1', timezone: 'Europe/Istanbul' });
    return { next: next[0] ? toSummary(next[0]) : null, last: last[0] ? toSummary(last[0]) : null };
  }

  async getMatch(id: string): Promise<Match | null> {
    const rows = await this.get('/fixtures', { id, timezone: 'Europe/Istanbul' });
    if (!rows.length) return null;
    const m = toMatch(rows[0]);
    // Bazı liglerde (ör. Süper Lig) kadroda teknik direktör gelmiyor: takımın güncel TD'sini ayrıca bul
    if (m.lineups) {
      for (const side of ['home', 'away'] as Side[]) {
        const l = m.lineups[side];
        if (l.coach) continue;
        const c = await this.teamCoach(m[side].id).catch(() => null);
        if (c) Object.assign(l, { coach: c.name, coachPhoto: c.photo });
      }
    }
    return m;
  }

  /** Takım profili: künye (haftada bir istek), son 5 ve sıradaki 3 maç (iki istek), TD (günde bir istek) */
  private teamInfos = new Map<string, { at: number; info: TeamProfile['team'] | null }>();
  async teamProfile(teamId: string): Promise<TeamProfile | null> {
    let hit = this.teamInfos.get(teamId);
    if (!hit || Date.now() - hit.at > 7 * 24 * 3600_000) {
      const r = (await this.get('/teams', { id: teamId }))[0];
      const info = r?.team
        ? {
            id: String(r.team.id),
            name: r.team.name,
            short: abbreviate(r.team.name),
            logo: r.team.logo,
            country: trCountry(r.team.country),
            founded: r.team.founded ?? undefined,
            venue: r.venue?.name ? { name: r.venue.name, city: r.venue.city ?? undefined, capacity: r.venue.capacity ?? undefined } : undefined,
          }
        : null;
      hit = { at: Date.now(), info };
      this.teamInfos.set(teamId, hit);
    }
    if (!hit.info) return null;
    const last = await this.get('/fixtures', { team: teamId, last: '5', timezone: 'Europe/Istanbul' });
    const next = await this.get('/fixtures', { team: teamId, next: '3', timezone: 'Europe/Istanbul' });
    const coach = await this.teamCoach(teamId).catch(() => null);
    return {
      team: hit.info,
      coach,
      last: last.map(toSummary).sort((a, b) => b.kickoff.localeCompare(a.kickoff)),
      next: next.map(toSummary).sort((a, b) => a.kickoff.localeCompare(b.kickoff)),
    };
  }

  /**
   * Maç öncesi bilgileri. İstekler: kazanma yüzdeleri + aralarındaki maçlar (1), sakat/cezalı (1),
   * iki takımın son 5 maçı (takım başına 1, 6 saat saklanır), son maçların kadro ve puanları (1, iki takım birlikte),
   * TD (takım başına günde 1). İlk açılışta en fazla 7 istek; sonra önbellekten.
   */
  async matchPreview(m: MatchSummary): Promise<Omit<MatchPreview, 'table'>> {
    const sides: Side[] = ['home', 'away'];
    // tahmin ve sakatlık verisi her maçta olmayabilir: biri gelmezse diğerleri yine gösterilir
    const pred = (await this.get('/predictions', { fixture: m.id }).catch(soft))?.[0] ?? null;
    const inj = (await this.get('/injuries', { fixture: m.id, timezone: 'Europe/Istanbul' }).catch(soft)) ?? [];
    const recent = { home: await this.teamRecent(m.home.id, m.id), away: await this.teamRecent(m.away.id, m.id) };

    // muhtemel 11: iki takımın son maçlarının kadroları tek istekte
    const lastIds = sides.map((s) => recent[s].find((x) => x.status === 'FT')?.id).filter((x): x is string => Boolean(x));
    const need = [...new Set(lastIds.filter((id) => !this.xiCache.has(id)))];
    if (need.length) {
      const rows = (await this.get('/fixtures', { ids: need.join('-'), timezone: 'Europe/Istanbul' }).catch(soft)) ?? [];
      for (const r of rows) this.xiCache.set(String(r.fixture.id), toMatch(r));
      if (this.xiCache.size > 200) this.xiCache.delete(this.xiCache.keys().next().value!);
    }
    const xi = {} as Record<Side, ProbableXI | null>;
    for (const s of sides) {
      const teamId = m[s].id;
      const src = recent[s].find((x) => x.status === 'FT');
      const full = src ? this.xiCache.get(src.id) : undefined;
      const at: Side | undefined = full ? (full.home.id === teamId ? 'home' : 'away') : undefined;
      const l = full && at ? full.lineups?.[at] : undefined;
      xi[s] =
        l && l.startXI.length
          ? {
              formation: l.formation,
              startXI: l.startXI.map((p) => ({ ...p, stats: p.stats?.rating != null ? { rating: p.stats.rating } : undefined })),
              from: { id: full!.id, kickoff: full!.kickoff, opponent: full![at === 'home' ? 'away' : 'home'].name, competition: full!.competition.name, home: at === 'home' },
            }
          : null;
    }

    const absent: Record<Side, AbsentPlayer[]> = { home: [], away: [] };
    const seen = new Set<string>();
    for (const r of inj) {
      const id = String(r.player?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const side: Side = String(r.team?.id) === m.home.id ? 'home' : 'away';
      const reason = String(r.player?.reason ?? '');
      const kind: AbsentPlayer['kind'] = /questionable|doubt/i.test(r.player?.type ?? '') ? 'doubt' : /suspen|card/i.test(reason) ? 'suspension' : 'injury';
      absent[side].push({ id, name: r.player?.name ?? '', photo: r.player?.photo ?? undefined, kind, reason: trReason(reason, kind) });
    }

    const pct = (v: any) => Number(String(v ?? '').replace('%', ''));
    const pp = pred?.predictions?.percent;
    const chances = pp && [pp.home, pp.draw, pp.away].every((v) => Number.isFinite(pct(v))) && pct(pp.home) + pct(pp.draw) + pct(pp.away) > 0 ? { home: pct(pp.home), draw: pct(pp.draw), away: pct(pp.away) } : null;
    const h2h = ((pred?.h2h ?? []) as any[])
      .map(toSummary)
      .filter((x) => x.status === 'FT' && x.id !== m.id)
      .sort((a, b) => b.kickoff.localeCompare(a.kickoff))
      .slice(0, 6);

    return {
      matchId: m.id,
      referee: m.referee,
      coaches: { home: await this.teamCoach(m.home.id).catch(() => null), away: await this.teamCoach(m.away.id).catch(() => null) },
      xi,
      absent,
      last: { home: recent.home.slice(0, 5), away: recent.away.slice(0, 5) },
      h2h,
      chances,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Muhtemel 11 kaynağı olan maçların tam detayı (kadro + oyuncu puanları); biten maç değişmez */
  private xiCache = new Map<string, Match>();
  /** Takımın oynanmış son maçları (en yeni önce); takım başına 6 saatte bir istek */
  private recent = new Map<string, { at: number; list: MatchSummary[] }>();
  private async teamRecent(teamId: string, exceptId: string): Promise<MatchSummary[]> {
    let hit = this.recent.get(teamId);
    if (!hit || Date.now() - hit.at > 6 * 3600_000) {
      const rows = (await this.get('/fixtures', { team: teamId, last: '6', timezone: 'Europe/Istanbul' }).catch(soft)) ?? [];
      hit = { at: Date.now(), list: rows.map(toSummary).sort((a, b) => b.kickoff.localeCompare(a.kickoff)) };
      this.recent.set(teamId, hit);
    }
    return hit.list.filter((x) => x.id !== exceptId && x.status === 'FT');
  }

  /** Takımın güncel teknik direktörü; takım başına günde en fazla bir istek */
  private coaches = new Map<string, { at: number; coach: { name: string; photo?: string } | null }>();
  private async teamCoach(teamId: string) {
    const hit = this.coaches.get(teamId);
    if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.coach;
    const rows = await this.get('/coachs', { team: teamId });
    const current = (c: any) => (c.career ?? []).find((x: any) => String(x.team?.id) === teamId && !x.end);
    const pick = rows.filter(current).sort((a: any, b: any) => String(current(b).start).localeCompare(String(current(a).start)))[0];
    const coach = pick?.name ? { name: String(pick.name), photo: pick.photo ?? undefined } : null;
    this.coaches.set(teamId, { at: Date.now(), coach });
    return coach;
  }
}

const utcDay = () => new Date().toISOString().slice(0, 10);

/** Maç öncesi ek verisinde kota/dakika sınırı hatası yukarı taşınır; diğer hatalarda o parça boş kalır */
function soft(e: unknown): null {
  if (e instanceof QuotaError || e instanceof RateError || e instanceof PlanError) throw e;
  console.warn(`[api-football] maç öncesi verisi alınamadı: ${e instanceof Error ? e.message : e}`);
  return null;
}

/** API-Football sakatlık nedenleri İngilizce gelir; sık görülenleri Türkçeleştir */
const REASON_TR: [RegExp, string][] = [
  [/red card/i, 'Kırmızı kart cezası'],
  [/yellow card/i, 'Sarı kart cezası'],
  [/suspen/i, 'Cezalı'],
  [/knee/i, 'Diz'],
  [/ankle/i, 'Ayak bileği'],
  [/hamstring/i, 'Arka adale'],
  [/thigh/i, 'Uyluk'],
  [/calf/i, 'Baldır'],
  [/groin/i, 'Kasık'],
  [/muscle/i, 'Kas'],
  [/back/i, 'Sırt'],
  [/shoulder/i, 'Omuz'],
  [/foot/i, 'Ayak'],
  [/achilles/i, 'Aşil'],
  [/hip/i, 'Kalça'],
  [/head|concussion/i, 'Kafa darbesi'],
  [/ligament|acl|cruciate/i, 'Bağ'],
  [/illness|virus|sick/i, 'Hastalık'],
  [/fracture|broken/i, 'Kırık'],
  [/national/i, 'Milli takım'],
  [/personal/i, 'Kişisel neden'],
  [/rest/i, 'Dinlendirme'],
];
function trReason(reason: string, kind: AbsentPlayer['kind']) {
  const hit = REASON_TR.find(([re]) => re.test(reason))?.[1];
  if (kind === 'suspension') return hit && hit !== 'Cezalı' ? hit : 'Cezalı';
  if (!hit) return kind === 'doubt' ? 'Şüpheli' : reason && !/unknown|injury$/i.test(reason) ? reason : 'Sakat';
  return /cezası|Cezalı|Milli|Kişisel|Dinlendirme|Hastalık/.test(hit) ? hit : `${hit}${/injury/i.test(reason) ? ' sakatlığı' : ''}`;
}
/** API-Football ülke adları İngilizce gelir; sık görülenleri Türkçeleştir */
const COUNTRY_TR: Record<string, string> = {
  Turkey: 'Türkiye',
  England: 'İngiltere',
  Spain: 'İspanya',
  Germany: 'Almanya',
  Italy: 'İtalya',
  France: 'Fransa',
  Netherlands: 'Hollanda',
  Portugal: 'Portekiz',
  Belgium: 'Belçika',
  Scotland: 'İskoçya',
  World: 'Dünya',
};
/** UEFA turnuvaları API'de "World" görünür: Avrupa yaz */
const trCountry = (c?: string, league?: string) => (!c ? undefined : c === 'World' && /UEFA/i.test(league ?? '') ? 'Avrupa' : (COUNTRY_TR[c] ?? c));

/** İstanbul saatine göre bugünden `offset` gün sonrasının tarihi (YYYY-MM-DD) */
export function istanbulDay(offset: number) {
  return new Date(Date.now() + offset * 24 * 60 * 60_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
}
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
    competition: { id: r.league?.id != null ? String(r.league.id) : undefined, name: r.league?.name, country: trCountry(r.league?.country, r.league?.name), logo: r.league?.logo, round: r.league?.round },
    status: mapStatus(r.fixture.status?.short),
    minute: r.fixture.status?.elapsed ?? null,
    extra: r.fixture.status?.extra ?? null,
    kickoff: r.fixture.date,
    venue: r.fixture.venue?.name ?? undefined,
    referee: r.fixture.referee ?? undefined,
    home: t(r.teams.home),
    away: t(r.teams.away),
    score: { home: r.goals?.home ?? 0, away: r.goals?.away ?? 0 },
  };
}

function toMatch(r: any): Match {
  const base = toSummary(r);
  const sideOf = (teamId: any): Side => (String(teamId) === base.home.id ? 'home' : 'away');

  // olay kimliği içerikten türetilir; sıra değişse de (ör. VAR iptali) olaya yazılan yorumlar doğru olayda kalır
  const seen = new Map<string, number>();
  const events: MatchEvent[] = (r.events ?? []).map((e: any) => {
    const detail: string = e.detail ?? '';
    let type: MatchEvent['type'] = 'var';
    if (e.type === 'Goal') type = detail === 'Own Goal' ? 'own_goal' : detail === 'Penalty' ? 'penalty' : detail === 'Missed Penalty' ? 'missed_penalty' : 'goal';
    else if (e.type === 'Card') type = /Red/i.test(detail) ? 'red' : 'yellow';
    else if (/subst/i.test(e.type)) type = 'sub';
    const key = `${base.id}-${type}-${e.time?.elapsed ?? 0}${e.time?.extra ? `+${e.time.extra}` : ''}-${e.player?.id ?? e.team?.id ?? ''}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return {
      id: n > 1 ? `${key}-${n}` : key,
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
        coachPhoto: l.coach?.photo ?? undefined,
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
