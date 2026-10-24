import type { AbsentPlayer, FootballProvider, Lineup, Match, MatchEvent, MatchPreview, PlayerProfile, MatchSummary, Player, Side, StatLine, Team, TeamProfile } from '../types.js';

/**
 * Demo sağlayıcı: API anahtarı yokken ya da API'ye ulaşılamadığında devreye girer.
 * Canlı maçları dakika dakika simüle eder (gol, kart, değişiklik, istatistik, oyuncu puanı).
 */

type DemoTeam = Team & { strength: number; formation: string; coach: string; pool: 'tr' | 'intl' };

const TEAMS: Record<string, DemoTeam> = {
  gs: { id: 'gs', name: 'Galatasaray', short: 'GS', color: '#a90432', strength: 1.15, formation: '4-2-3-1', coach: 'Kerem Aydın', pool: 'tr' },
  fb: { id: 'fb', name: 'Fenerbahçe', short: 'FB', color: '#f5d10b', strength: 1.12, formation: '4-3-3', coach: 'Selim Demirtaş', pool: 'tr' },
  bjk: { id: 'bjk', name: 'Beşiktaş', short: 'BJK', color: '#e5e5e5', strength: 1.05, formation: '4-4-2', coach: 'Orhan Yalçın', pool: 'tr' },
  ts: { id: 'ts', name: 'Trabzonspor', short: 'TS', color: '#7a1e3a', strength: 1.0, formation: '4-2-3-1', coach: 'Hakan Karadeniz', pool: 'tr' },
  ibfk: { id: 'ibfk', name: 'Başakşehir', short: 'İBFK', color: '#f26522', strength: 0.95, formation: '3-5-2', coach: 'Murat Ersoy', pool: 'tr' },
  sam: { id: 'sam', name: 'Samsunspor', short: 'SAM', color: '#e30613', strength: 0.92, formation: '4-1-4-1', coach: 'Tolga Er', pool: 'tr' },
  goz: { id: 'goz', name: 'Göztepe', short: 'GÖZ', color: '#ffd200', strength: 0.9, formation: '3-4-3', coach: 'Emre Kurt', pool: 'tr' },
  kas: { id: 'kas', name: 'Kasımpaşa', short: 'KAS', color: '#1b3e8f', strength: 0.88, formation: '4-4-2', coach: 'Barış Öztürk', pool: 'tr' },
  rma: { id: 'rma', name: 'Real Madrid', short: 'RMA', color: '#febe10', strength: 1.22, formation: '4-3-3', coach: 'Diego Morales', pool: 'intl' },
  fcb: { id: 'fcb', name: 'Barcelona', short: 'BAR', color: '#a50044', strength: 1.18, formation: '4-3-3', coach: 'Pau Ferrer', pool: 'intl' },
  ars: { id: 'ars', name: 'Arsenal', short: 'ARS', color: '#ef0107', strength: 1.17, formation: '4-3-3', coach: 'Liam Carter', pool: 'intl' },
  mci: { id: 'mci', name: 'Manchester City', short: 'MCI', color: '#6cabdd', strength: 1.2, formation: '4-2-3-1', coach: 'Jonas Weber', pool: 'intl' },
  bay: { id: 'bay', name: 'Bayern München', short: 'BAY', color: '#dc052d', strength: 1.19, formation: '4-2-3-1', coach: 'Lukas Brandt', pool: 'intl' },
  int: { id: 'int', name: 'Inter', short: 'INT', color: '#0068a8', strength: 1.1, formation: '3-5-2', coach: 'Marco Bellini', pool: 'intl' },
};

const NAMES = {
  tr: {
    first: ['Arda', 'Kerem', 'Emir', 'Yusuf', 'Barış', 'Ozan', 'Cenk', 'Mert', 'Kaan', 'Efe', 'Burak', 'Ferdi', 'Uğur', 'Halil', 'Oğuz', 'Semih', 'Doğukan', 'Eren', 'Tarık', 'Sinan', 'Berkan', 'Okay', 'İrfan', 'Abdülkerim', 'Salih', 'Zeki', 'Rıdvan', 'Onur', 'Can', 'Ahmet'],
    last: ['Yıldız', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Erdem', 'Tekin', 'Akın', 'Bulut', 'Güler', 'Karaca', 'Uçar', 'Sarı', 'Altun', 'Ateş', 'Bozkurt', 'Ekinci', 'Tuna'],
    foreign: ['L. Moreira', 'D. Okafor', 'A. Silva', 'M. Kovač', 'J. Mensah', 'R. Duarte', 'S. Diallo', 'P. Novak', 'T. Lindqvist', 'K. Adeyemi', 'N. Petrović', 'E. Costa'],
  },
  intl: {
    first: ['Lucas', 'Mateo', 'Jamal', 'Oliver', 'Hugo', 'Leon', 'Marco', 'Kai', 'Theo', 'Rafael', 'Noah', 'Luca', 'Elias', 'Adrian', 'Samuel', 'Ivan', 'Bruno', 'Felix', 'Diego', 'Jules'],
    last: ['García', 'Müller', 'Rossi', 'Silva', 'Dubois', 'Smith', 'Fernández', 'Schmidt', 'Bianchi', 'Martín', 'Walker', 'Kovačić', 'Santos', 'Moreau', 'Hansen', 'Okoye', 'Romero', 'Fischer', 'Ricci', 'Navarro'],
    foreign: [] as string[],
  },
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const pick = <T>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)];

function buildSquad(team: DemoTeam): Lineup {
  const r = rng(hash(team.id));
  const used = new Set<string>();
  const names = NAMES[team.pool];
  const name = () => {
    for (;;) {
      const n = names.foreign.length && r() < 0.3 ? pick(names.foreign, r) : `${pick(names.first, r)[0]}. ${pick(names.last, r)}`;
      if (!used.has(n)) return used.add(n), n;
    }
  };
  const nums = new Set<number>();
  const num = (pref: number[]) => {
    for (const n of pref) if (!nums.has(n)) return nums.add(n), n;
    for (let n = 2; ; n++) if (!nums.has(n)) return nums.add(n), n;
  };
  const rows = team.formation.split('-').map(Number);
  const startXI: Player[] = [{ id: `${team.id}-p1`, name: name(), number: num([1]), pos: 'G', grid: '1:1' }];
  rows.forEach((count, i) => {
    const pos: Player['pos'] = i === 0 ? 'D' : i === rows.length - 1 ? 'F' : 'M';
    const pref = pos === 'D' ? [2, 3, 4, 5, 6, 15] : pos === 'M' ? [6, 8, 10, 7, 11, 14, 17] : [9, 11, 7, 19, 10];
    for (let c = 1; c <= count; c++) {
      startXI.push({ id: `${team.id}-p${startXI.length + 1}`, name: name(), number: num(pref), pos, grid: `${i + 2}:${c}` });
    }
  });
  const subPos: Player['pos'][] = ['G', 'D', 'D', 'M', 'M', 'M', 'F', 'F', 'F'];
  const subs: Player[] = subPos.map((pos, i) => ({ id: `${team.id}-s${i + 1}`, name: name(), number: num(pos === 'G' ? [12, 23, 99] : [20 + i]), pos }));
  return { formation: team.formation, coach: team.coach, startXI, subs };
}

interface Raw {
  possession: number;
  xg: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  offsides: number;
  yellow: number;
  red: number;
  saves: number;
  passes: number;
  passOk: number;
}
const emptyRaw = (): Raw => ({ possession: 50, xg: 0, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, offsides: 0, yellow: 0, red: 0, saves: 0, passes: 0, passOk: 0 });

interface SimMatch {
  id: string;
  competition: MatchSummary['competition'];
  venue: string;
  home: DemoTeam;
  away: DemoTeam;
  kickoffAt: number;
  phase: 'pre' | '1H' | 'HT' | '2H' | 'FT';
  minute: number; // geçen dakika (uzatmalar dahil, 45+2 → 47 değil, ayrı tutulur)
  extra: number;
  added: [number, number];
  htLeft: number;
  finishedAt?: number;
  score: { home: number; away: number };
  events: MatchEvent[];
  lineups: { home: Lineup; away: Lineup };
  onPitch: Record<Side, Set<string>>;
  subsMade: Record<Side, number>;
  raw: Record<Side, Raw>;
  r: () => number;
  seq: number;
}

const COMPS = {
  sl: { name: 'Trendyol Süper Lig', country: 'Türkiye', round: '9. Hafta' },
  ucl: { name: 'UEFA Şampiyonlar Ligi', country: 'Avrupa', round: 'Lig Aşaması - 3. Maç' },
  fr: { name: 'Hazırlık Maçı', country: 'Dünya', round: 'Dostluk' },
};

const VENUES: Record<string, string> = {
  gs: 'RAMS Park', fb: 'Ülker Stadyumu', bjk: 'Tüpraş Stadyumu', ts: 'Papara Park', ibfk: 'Başakşehir Fatih Terim Stadyumu',
  sam: 'Samsun 19 Mayıs Stadyumu', goz: 'Gürsel Aksel Stadyumu', kas: 'Recep Tayyip Erdoğan Stadyumu', rma: 'Santiago Bernabéu',
  fcb: 'Spotify Camp Nou', ars: 'Emirates Stadium', mci: 'Etihad Stadium', bay: 'Allianz Arena', int: 'San Siro',
};

export class DemoProvider implements FootballProvider {
  readonly name = 'demo';
  readonly isDemo = true;
  readonly pollMs: { list: number; detail: number };
  private matches = new Map<string, SimMatch>();
  private counter = 0;
  private timer?: NodeJS.Timeout;

  constructor(private tickMs = 4000) {
    this.pollMs = { list: tickMs, detail: tickMs };
    const now = Date.now();
    // [ev, dep, lig, başlangıç durumu]
    this.add('gs', 'fb', COMPS.sl, { liveAt: 23 });
    this.add('bjk', 'ts', COMPS.sl, { liveAt: 61 });
    this.add('rma', 'fcb', COMPS.ucl, { liveAt: 78 });
    this.add('ibfk', 'sam', COMPS.sl, { liveAt: 45, toHalfTime: true });
    this.add('goz', 'kas', COMPS.sl, { finished: true });
    this.add('ars', 'mci', COMPS.ucl, { kickoffAt: now + 2 * 60_000 });
    this.add('bay', 'int', COMPS.ucl, { kickoffAt: now + 25 * 60_000 });
  }

  start() {
    this.timer ??= setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async listMatches(): Promise<MatchSummary[]> {
    return [...this.matches.values()].map((m) => this.summary(m));
  }
  async getMatch(id: string): Promise<Match | null> {
    const m = this.matches.get(id);
    return m ? this.full(m) : null;
  }
  /** Demo takım profili: simüle edilen maçlarından sonra uydurma geçmiş maçlar (adresi yok, tıklanmaz) */
  async teamProfile(teamId: string): Promise<TeamProfile | null> {
    const t = TEAMS[teamId];
    if (!t) return null;
    const { strength, formation, coach, pool, ...team } = t;
    const r = rng(hash(`profil-${teamId}`));
    const rivals = Object.values(TEAMS).filter((x) => x.id !== teamId && x.pool === pool);
    const mine = [...this.matches.values()].filter((m) => m.home.id === teamId || m.away.id === teamId).map((m) => this.summary(m));
    const old = Array.from({ length: 5 }, (_, i): MatchSummary => {
      const { strength, formation, coach, pool: _p, ...o } = rivals[Math.floor(r() * rivals.length)];
      const atHome = r() < 0.5;
      return {
        id: '',
        competition: pool === 'tr' ? { name: COMPS.sl.name, country: COMPS.sl.country, round: `${8 - i}. Hafta` } : { name: COMPS.ucl.name, country: COMPS.ucl.country },
        status: 'FT',
        minute: 90,
        kickoff: new Date(Date.now() - (i + 1) * 7 * 24 * 3600_000).toISOString(),
        home: atHome ? team : o,
        away: atHome ? o : team,
        score: { home: Math.floor(r() * 4), away: Math.floor(r() * 3) },
      };
    });
    return {
      team: { ...team, country: pool === 'tr' ? 'Türkiye' : undefined, venue: { name: VENUES[teamId] } },
      coach: { name: coach },
      last: [...mine.filter((m) => m.status !== 'SCHEDULED'), ...old].slice(0, 5),
      next: mine.filter((m) => m.status === 'SCHEDULED'),
    };
  }

  /** Demo maç öncesi: son maç olarak kendi kadrosu ve uydurma puanlar, profildeki geçmiş maçlar */
  async matchPreview(m: MatchSummary): Promise<Omit<MatchPreview, 'table'> | null> {
    const sim = this.matches.get(m.id);
    if (!sim) return null;
    const r = rng(hash(`onizleme-${m.id}`));
    const sides: Side[] = ['home', 'away'];
    const xi = {} as MatchPreview['xi'];
    const absent: Record<Side, AbsentPlayer[]> = { home: [], away: [] };
    const last = {} as MatchPreview['last'];
    const coaches = {} as MatchPreview['coaches'];
    for (const s of sides) {
      const team = TEAMS[m[s].id];
      const l = sim.lineups[s];
      xi[s] = {
        formation: l.formation,
        startXI: l.startXI.map((p) => ({ ...p, stats: { rating: round1(6 + r() * 2.6) } })),
        from: { id: '', kickoff: new Date(Date.now() - 4 * 24 * 3600_000).toISOString(), opponent: 'Kasımpaşa', competition: m.competition.name, home: r() < 0.5 },
      };
      const out = l.subs.slice(-2);
      absent[s] = out.map((p, i): AbsentPlayer => ({ id: p.id, name: p.name, kind: i ? 'suspension' : 'injury', reason: i ? 'Sarı kart cezası' : 'Diz sakatlığı' }));
      last[s] = ((await this.teamProfile(m[s].id))?.last ?? []).filter((x) => x.status === 'FT');
      coaches[s] = team ? { name: team.coach } : null;
    }
    const h2h = Array.from({ length: 5 }, (_, i): MatchSummary => {
      const flip = i % 2 === 1;
      return { id: '', competition: m.competition, status: 'FT', minute: 90, kickoff: new Date(Date.now() - (i + 1) * 180 * 24 * 3600_000).toISOString(), home: flip ? m.away : m.home, away: flip ? m.home : m.away, score: { home: Math.floor(r() * 4), away: Math.floor(r() * 3) } };
    });
    const hw = Math.round(30 + r() * 30);
    const dw = Math.round(20 + r() * 15);
    return { matchId: m.id, referee: 'Ali Şansalan, Turkey', coaches, xi, absent, last, h2h, chances: { home: hw, draw: dw, away: 100 - hw - dw }, updatedAt: new Date().toISOString() };
  }

  /** Demo oyuncu profili (uydurma künye ve sezon istatistikleri) */
  async playerProfile(playerId: string): Promise<PlayerProfile | null> {
    const teamId = playerId.split('-p')[0];
    const team = TEAMS[teamId];
    if (!team) return null;
    const p = [...buildSquad(team).startXI, ...buildSquad(team).subs].find((x) => x.id === playerId);
    if (!p) return null;
    const r = rng(hash(`oyuncu-${playerId}`));
    const apps = 4 + Math.floor(r() * 9);
    const pos = { G: 'Kaleci', D: 'Defans', M: 'Orta saha', F: 'Forvet' }[p.pos ?? 'M'];
    const comp = (league: string, n: number) => ({ league, apps: n, starts: Math.max(0, n - 2), minutes: n * 78, goals: p.pos === 'F' ? Math.floor(r() * 7) : Math.floor(r() * 2), assists: Math.floor(r() * 4), rating: Math.round((6.4 + r() * 1.2) * 10) / 10, yellow: Math.floor(r() * 3), red: 0 });
    return {
      id: p.id,
      name: p.name,
      age: 19 + Math.floor(r() * 15),
      nationality: team.pool === 'tr' ? 'Türkiye' : 'İspanya',
      height: `${170 + Math.floor(r() * 25)} cm`,
      weight: `${65 + Math.floor(r() * 20)} kg`,
      position: pos,
      number: p.number,
      team: { id: team.id, name: team.name },
      season: 2026,
      comps: [comp(team.pool === 'tr' ? 'Süper Lig' : 'La Liga', apps), comp('UEFA Şampiyonlar Ligi', 3)],
    };
  }

  // ---------------------------------------------------------------- kurulum

  private add(h: string, a: string, comp: MatchSummary['competition'], opts: { liveAt?: number; toHalfTime?: boolean; finished?: boolean; kickoffAt?: number }) {
    const id = `demo-${++this.counter}`;
    const r = rng(hash(id + h + a + Date.now()));
    const home = TEAMS[h];
    const away = TEAMS[a];
    const lineups = { home: buildSquad(home), away: buildSquad(away) };
    for (const l of [lineups.home, lineups.away]) for (const p of [...l.startXI, ...l.subs]) p.stats = { rating: 6.5, minutes: 0, goals: 0, assists: 0, shots: 0, passes: 0, yellow: 0, red: 0 };
    const m: SimMatch = {
      id,
      competition: comp,
      venue: VENUES[h] ?? '',
      home,
      away,
      kickoffAt: opts.kickoffAt ?? Date.now(),
      phase: 'pre',
      minute: 0,
      extra: 0,
      added: [1 + Math.floor(r() * 4), 2 + Math.floor(r() * 5)],
      htLeft: 0,
      score: { home: 0, away: 0 },
      events: [],
      lineups,
      onPitch: { home: new Set(lineups.home.startXI.map((p) => p.id)), away: new Set(lineups.away.startXI.map((p) => p.id)) },
      subsMade: { home: 0, away: 0 },
      raw: { home: emptyRaw(), away: emptyRaw() },
      r,
      seq: 0,
    };
    this.matches.set(id, m);

    if (opts.liveAt != null || opts.finished) {
      const target = opts.finished || opts.toHalfTime ? Infinity : opts.liveAt!;
      m.kickoffAt = Date.now() - (opts.finished ? 110 : (opts.liveAt ?? 45) + (opts.toHalfTime ? 5 : 3)) * 60_000;
      this.advance(m); // başlama vuruşu
      let guard = 0;
      while (m.phase !== 'FT' && guard++ < 200) {
        const done = !opts.finished && m.minute >= target && m.extra === 0 && (m.phase === '1H' ? target <= 45 : true);
        if (done) break;
        this.advance(m, true);
        if (opts.toHalfTime && m.phase === 'HT') break;
      }
      if (m.phase === 'FT') m.finishedAt = Date.now();
    }
  }

  // ---------------------------------------------------------------- simülasyon

  private tick() {
    for (const m of [...this.matches.values()]) {
      if (m.phase === 'FT') {
        // Biten maçlar bir süre listede kalır, sonra yerine yeni bir fikstür gelir
        if (Date.now() - (m.finishedAt ?? 0) > 15 * 60_000) this.replace(m);
        continue;
      }
      this.advance(m);
    }
  }

  private replace(old: SimMatch) {
    this.matches.delete(old.id);
    const busy = new Set([...this.matches.values()].flatMap((m) => [m.home.id, m.away.id]));
    const free = Object.keys(TEAMS).filter((t) => !busy.has(t));
    if (free.length < 2) return;
    const r = old.r;
    const h = free.splice(Math.floor(r() * free.length), 1)[0];
    const a = free[Math.floor(r() * free.length)];
    const comp = TEAMS[h].pool === 'tr' && TEAMS[a].pool === 'tr' ? COMPS.sl : TEAMS[h].pool === 'intl' && TEAMS[a].pool === 'intl' ? COMPS.ucl : COMPS.fr;
    this.add(h, a, comp, { kickoffAt: Date.now() + 3 * 60_000 });
  }

  /** Maçı bir oyun dakikası ilerletir. */
  private advance(m: SimMatch, fast = false) {
    if (m.phase === 'pre') {
      if (Date.now() >= m.kickoffAt || fast) {
        m.phase = '1H';
        m.minute = 1;
      }
      return;
    }
    if (m.phase === 'HT') {
      if (--m.htLeft <= 0 || fast) {
        m.phase = '2H';
        m.minute = 46;
        m.extra = 0;
      }
      return;
    }
    // dakika ilerlet
    const limit = m.phase === '1H' ? 45 : 90;
    const added = m.phase === '1H' ? m.added[0] : m.added[1];
    if (m.minute < limit) m.minute++;
    else if (m.extra < added) m.extra++;
    else {
      if (m.phase === '1H') {
        m.phase = 'HT';
        m.htLeft = 5;
      } else {
        m.phase = 'FT';
        m.finishedAt = Date.now();
      }
      m.extra = 0;
      return;
    }
    this.simulateMinute(m);
  }

  private players(m: SimMatch, side: Side): Player[] {
    const l = m.lineups[side];
    return [...l.startXI, ...l.subs].filter((p) => m.onPitch[side].has(p.id));
  }

  private event(m: SimMatch, e: Omit<MatchEvent, 'id' | 'minute' | 'extra'>) {
    const minute = m.phase === '1H' ? Math.min(m.minute, 45) : Math.min(m.minute, 90);
    m.events.push({ id: `${m.id}-e${++m.seq}`, minute, extra: m.extra || undefined, ...e });
  }

  private simulateMinute(m: SimMatch) {
    const r = m.r;
    const sides: Side[] = ['home', 'away'];
    const str = { home: m.home.strength * 1.06, away: m.away.strength };
    // topla oynama rastgele yürüyüşü
    const target = 50 + (str.home - str.away) * 40;
    const ph = m.raw.home;
    ph.possession = Math.max(28, Math.min(72, ph.possession + (target - ph.possession) * 0.1 + (r() - 0.5) * 6));
    m.raw.away.possession = 100 - ph.possession;

    for (const side of sides) {
      const opp: Side = side === 'home' ? 'away' : 'home';
      const raw = m.raw[side];
      const pitch = this.players(m, side);
      const outfield = pitch.filter((p) => p.pos !== 'G');
      const poss = raw.possession / 100;
      const attack = str[side] / str[opp];

      // paslar
      const passes = Math.round(2 + poss * 6 + r() * 2);
      raw.passes += passes;
      raw.passOk += Math.round(passes * (0.74 + r() * 0.16));
      for (let i = 0; i < passes; i++) {
        const p = pick(outfield, r);
        if (p?.stats) p.stats.passes = (p.stats.passes ?? 0) + 1;
      }
      for (const p of pitch) {
        if (!p.stats) continue;
        p.stats.minutes = (p.stats.minutes ?? 0) + 1;
        p.stats.rating = clampRating((p.stats.rating ?? 6.5) + (r() - 0.48) * 0.04);
      }

      // şut / gol
      if (r() < 0.12 * attack * (0.6 + poss)) {
        const shooter = weighted(outfield, r, (p) => (p.pos === 'F' ? 5 : p.pos === 'M' ? 3 : 1));
        raw.shots++;
        const xg = 0.03 + r() * r() * 0.5;
        raw.xg += xg;
        if (shooter?.stats) shooter.stats.shots = (shooter.stats.shots ?? 0) + 1;
        if (r() < 0.42) {
          raw.shotsOnTarget++;
          if (r() < Math.min(0.55, 0.15 + xg)) {
            this.goal(m, side, shooter, outfield);
          } else {
            m.raw[opp].saves++;
            const gk = this.players(m, opp).find((p) => p.pos === 'G');
            if (gk?.stats) gk.stats.rating = clampRating((gk.stats.rating ?? 6.5) + 0.15);
          }
        } else if (r() < 0.35) raw.corners++;
      }

      // nadir: kaçan penaltı
      if (r() < 0.0015) {
        const taker = weighted(outfield, r, (p) => (p.pos === 'F' ? 4 : 1));
        this.event(m, { type: 'missed_penalty', side, player: taker?.name, playerId: taker?.id, detail: 'Kaçan penaltı' });
        raw.shots++;
        if (taker?.stats) taker.stats.rating = clampRating((taker.stats.rating ?? 6.5) - 0.6);
      }
      if (r() < 0.025) raw.offsides++;
      if (r() < 0.13) {
        raw.fouls++;
        const fouler = pick(outfield, r);
        if (fouler && r() < 0.17) this.card(m, side, fouler);
      }
      // VAR incelemesi
      if (r() < 0.004) this.event(m, { type: 'var', side, detail: 'VAR incelemesi: pozisyon kontrol edildi, karar geçerli' });

      // oyuncu değişikliği
      const minuteNow = m.phase === '2H' ? m.minute : 0;
      if (minuteNow >= 55 && m.subsMade[side] < 5 && r() < 0.055 + (minuteNow > 75 ? 0.06 : 0)) this.substitute(m, side);
    }
  }

  private goal(m: SimMatch, side: Side, shooter: Player | undefined, outfield: Player[]) {
    const r = m.r;
    const opp: Side = side === 'home' ? 'away' : 'home';
    if (r() < 0.04) {
      // kendi kalesine
      const og = pick(this.players(m, opp).filter((p) => p.pos === 'D'), r) ?? pick(this.players(m, opp), r);
      m.score[side]++;
      this.event(m, { type: 'own_goal', side, player: og?.name, playerId: og?.id, detail: 'Kendi kalesine' });
      if (og?.stats) og.stats.rating = clampRating((og.stats.rating ?? 6.5) - 0.8);
      return;
    }
    const pen = r() < 0.09;
    const assist = !pen && r() < 0.7 ? pick(outfield.filter((p) => p !== shooter), r) : undefined;
    m.score[side]++;
    this.event(m, {
      type: pen ? 'penalty' : 'goal',
      side,
      player: shooter?.name,
      playerId: shooter?.id,
      related: assist?.name,
      relatedId: assist?.id,
      detail: pen ? 'Penaltı golü' : 'Gol',
    });
    if (shooter?.stats) {
      shooter.stats.goals = (shooter.stats.goals ?? 0) + 1;
      shooter.stats.rating = clampRating((shooter.stats.rating ?? 6.5) + 1.0);
    }
    if (assist?.stats) {
      assist.stats.assists = (assist.stats.assists ?? 0) + 1;
      assist.stats.rating = clampRating((assist.stats.rating ?? 6.5) + 0.6);
    }
    const gk = this.players(m, opp).find((p) => p.pos === 'G');
    if (gk?.stats) gk.stats.rating = clampRating((gk.stats.rating ?? 6.5) - 0.3);
  }

  private card(m: SimMatch, side: Side, p: Player) {
    const raw = m.raw[side];
    const s = p.stats!;
    const straightRed = m.r() < 0.04;
    if (straightRed || (s.yellow ?? 0) >= 1) {
      if (!straightRed) {
        s.yellow = 2;
        raw.yellow++;
      }
      s.red = 1;
      raw.red++;
      s.rating = clampRating((s.rating ?? 6.5) - 1.2);
      m.onPitch[side].delete(p.id);
      this.event(m, { type: 'red', side, player: p.name, playerId: p.id, detail: straightRed ? 'Direkt kırmızı kart' : 'İkinci sarıdan kırmızı' });
    } else {
      s.yellow = 1;
      raw.yellow++;
      s.rating = clampRating((s.rating ?? 6.5) - 0.3);
      this.event(m, { type: 'yellow', side, player: p.name, playerId: p.id, detail: 'Sarı kart' });
    }
  }

  private substitute(m: SimMatch, side: Side) {
    const l = m.lineups[side];
    const used = new Set(m.events.filter((e) => e.type === 'sub' && e.side === side).flatMap((e) => [e.playerId, e.relatedId]));
    const bench = l.subs.filter((p) => !m.onPitch[side].has(p.id) && !used.has(p.id) && p.pos !== 'G');
    const candidates = this.players(m, side).filter((p) => p.pos !== 'G' && !used.has(p.id));
    if (!bench.length || !candidates.length) return;
    candidates.sort((a, b) => (a.stats?.rating ?? 6.5) - (b.stats?.rating ?? 6.5));
    const out = candidates[0];
    const inn = bench.find((p) => p.pos === out.pos) ?? bench[0];
    m.onPitch[side].delete(out.id);
    m.onPitch[side].add(inn.id);
    m.subsMade[side]++;
    this.event(m, { type: 'sub', side, player: out.name, playerId: out.id, related: inn.name, relatedId: inn.id, detail: 'Oyuncu değişikliği' });
  }

  // ---------------------------------------------------------------- dönüştürme

  private summary(m: SimMatch): MatchSummary {
    const status = m.phase === 'pre' ? 'SCHEDULED' : m.phase === 'HT' ? 'HT' : m.phase === 'FT' ? 'FT' : 'LIVE';
    const strip = ({ strength, formation, coach, pool, ...t }: DemoTeam): Team => t;
    return {
      id: m.id,
      competition: m.competition,
      status,
      minute: status === 'LIVE' ? m.minute : status === 'HT' ? 45 : status === 'FT' ? 90 : null,
      extra: status === 'LIVE' && m.extra ? m.extra : null,
      kickoff: new Date(m.kickoffAt).toISOString(),
      venue: m.venue,
      home: strip(m.home),
      away: strip(m.away),
      score: { ...m.score },
    };
  }

  private full(m: SimMatch): Match {
    const s = this.summary(m);
    const started = m.phase !== 'pre';
    const h = m.raw.home;
    const a = m.raw.away;
    const stats: StatLine[] = started
      ? [
          { key: 'possession', label: 'Topla oynama', home: Math.round(h.possession), away: 100 - Math.round(h.possession), unit: '%' },
          { key: 'xg', label: 'Gol beklentisi (xG)', home: round2(h.xg), away: round2(a.xg) },
          { key: 'shots', label: 'Toplam şut', home: h.shots, away: a.shots },
          { key: 'shotsOnTarget', label: 'İsabetli şut', home: h.shotsOnTarget, away: a.shotsOnTarget },
          { key: 'corners', label: 'Korner', home: h.corners, away: a.corners },
          { key: 'fouls', label: 'Faul', home: h.fouls, away: a.fouls },
          { key: 'offsides', label: 'Ofsayt', home: h.offsides, away: a.offsides },
          { key: 'yellow', label: 'Sarı kart', home: h.yellow, away: a.yellow },
          { key: 'red', label: 'Kırmızı kart', home: h.red, away: a.red },
          { key: 'saves', label: 'Kurtarış', home: h.saves, away: a.saves },
          { key: 'passes', label: 'Pas', home: h.passes, away: a.passes },
          { key: 'passAcc', label: 'Pas isabeti', home: pct(h.passOk, h.passes), away: pct(a.passOk, a.passes), unit: '%' },
        ]
      : [];
    const cloneLineup = (l: Lineup, side: Side): Lineup => ({
      ...l,
      startXI: l.startXI.map((p) => ({ ...p, stats: started ? { ...p.stats, rating: round1(p.stats!.rating!) } : undefined })),
      subs: l.subs.map((p) => {
        const played = (p.stats?.minutes ?? 0) > 0 || m.onPitch[side].has(p.id);
        return { ...p, stats: started && played ? { ...p.stats, rating: round1(p.stats!.rating!) } : undefined };
      }),
    });
    return {
      ...s,
      events: m.events.map((e) => ({ ...e })),
      lineups: { home: cloneLineup(m.lineups.home, 'home'), away: cloneLineup(m.lineups.away, 'away') },
      stats,
    };
  }
}

function weighted<T>(items: T[], r: () => number, w: (x: T) => number): T | undefined {
  const total = items.reduce((s, x) => s + w(x), 0);
  let t = r() * total;
  for (const x of items) if ((t -= w(x)) <= 0) return x;
  return items[items.length - 1];
}
const clampRating = (x: number) => Math.max(3, Math.min(10, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
