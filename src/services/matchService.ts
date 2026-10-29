import { EventEmitter } from 'node:events';
import { istanbulDay } from '../providers/apiFootball.js';
import type { FootballProvider, Match, MatchEvent, MatchPreview, PlayerProfile, MatchSummary, StandingRow, Standings, TeamFixtures, TeamProfile } from '../types.js';

const MIN = 60_000;

/**
 * Sağlayıcıyı yoklar, sonuçları önbelleğe alır ve değişiklikleri olay olarak yayar.
 *
 * Kota bütçesi (sağlayıcı liveMatches destekliyorsa):
 * - Oynanan tüm maçların skoru, dakikası ve olayları tek istekte gelir ("canlı akış"); maç başına istek atılmaz.
 * - Kadro/istatistik için tam detay yalnızca izleyicisi olan maçlarda, seyrek çekilir; maç bitince bir kez daha.
 * - Canlı akış ve liste aralıkları kalan hakka göre ayarlanır: kalan istekler günün son maçının bitişine kadar
 *   eşit yayılır, böylece kota gün içinde tükenmez (bütçe bolsa alt sınırlar kullanılır).
 * - Öncelikli takımlar (GS, FB, BJK, TS): maçlarının kadroları açıklanır açıklanmaz çekilir, canlıyken tam detayı
 *   kimse izlemese de sık yenilenir. Diğer maçlarda tam detay yalnızca izleniyorsa ve seyrek çekilir.
 * - Kota sıkışırsa önce diğer maçlar, en son öncelikli maçlar yavaşlar.
 *
 * - Öncelikli takımların bir sonraki/son maçı (bugün oynamasalar da lobide gösterilsin diye) 6 saatte bir,
 *   ya da bilinen sonraki maçları bitince yenilenir: takım başına 2 istek.
 * - Yarının maçları saatte bir (gün dönünce hemen) tek istekle; puan durumu 3 saatte bir ya da ligde maç bitince.
 * - Dünün maçları gün dönünce bir kez tek istekle; gece yarısını geçen maçın skoru canlı akıştan güncellenir.
 * - Gün dönümü (İstanbul 00:00) dakikada bir kontrol edilir: bugün/yarın/dün listeleri hemen yeni güne geçer.
 * - Takım profili istenince çekilir (künye haftada bir, son/sıradaki maçlar 3 saatte bir).
 * - Maç öncesi bilgileri yalnızca başlamamış maçın sayfası açılınca çekilir (ilk açılışta en fazla 7 istek),
 *   3 saat saklanır; maçın ligi lobidekinden farklıysa o ligin puan durumu 6 saatte bir (1 istek).
 *
 * Olaylar: 'list' (MatchSummary[]), 'match' (Match), 'events' (matchId, MatchEvent[] yeni olaylar), 'clubs', 'tomorrow', 'yesterday', 'standings'
 */
export class MatchService extends EventEmitter {
  private list: MatchSummary[] = [];
  private listJson = '';
  /** Bugünün listesinin İstanbul tarihi (gün dönümünü yakalamak için) */
  private listDay = '';
  private dayTimer?: NodeJS.Timeout;
  private profiles = new Map<string, { at: number; p: TeamProfile }>();
  private profileJobs = new Map<string, Promise<TeamProfile | null>>();
  /** fullAt: son tam detay (kadro/istatistik) çekimi; canlı akış güncellemeleri bunu değiştirmez */
  private details = new Map<string, { match: Match; json: string; fullAt: number }>();
  private detailJobs = new Map<string, Promise<Match | null>>();
  private notFound = new Map<string, number>();
  private unknownFetches: number[] = [];
  private watched = new Map<string, number>();
  private listTimer?: NodeJS.Timeout;
  private detailTimer?: NodeJS.Timeout;
  private liveTimer?: NodeJS.Timeout;
  private focusTimer?: NodeJS.Timeout;
  private clubsTimer?: NodeJS.Timeout;
  private clubs = new Map<string, TeamFixtures>();
  private clubsAt = 0;
  private clubsJson = '';
  private extraTimer?: NodeJS.Timeout;
  private tomorrow: MatchSummary[] = [];
  private tomorrowDay = '';
  private tomorrowAt = 0;
  private yesterday: MatchSummary[] = [];
  private yesterdayDay = '';
  private table: Standings | null = null;
  private tableAt = 0;
  /** Son puan durumu çekiminde bitmiş görünen lig maçları */
  private tableSeen = new Set<string>();
  private standingsLeague: string;
  private focus: Set<string>;
  private focusDetailMs: number;
  private otherDetailMs: number;

  constructor(
    private provider: FootballProvider,
    opts: { teams?: string[]; detailMs?: number; otherDetailMs?: number; standingsLeague?: string } = {},
  ) {
    super();
    this.standingsLeague = opts.standingsLeague ?? '203';
    this.focus = new Set(opts.teams ?? []);
    this.focusDetailMs = opts.detailMs ?? 10 * MIN;
    this.otherDetailMs = opts.otherDetailMs ?? 60 * MIN;
  }

  /** 2: iki öncelikli takımın derbisi, 1: öncelikli takımın maçı, 0: diğer */
  focusLevel(m: { home: { id: string }; away: { id: string } }) {
    return Number(this.focus.has(m.home.id)) + Number(this.focus.has(m.away.id));
  }

  get providerInfo() {
    const p = this.provider as any;
    const quota = typeof p.quota === 'function' ? p.quota() : null;
    return {
      name: this.provider.name,
      demo: this.provider.isDemo,
      error: p.lastError ?? null,
      stale: Boolean(p.stale),
      quota: quota && {
        ...quota,
        listEveryMin: Math.round(this.listInterval() / MIN),
        // null: şu an oynanan maç yok, canlı akış beklemede
        liveEveryMin: this.liveFeedOn() && this.liveDue() ? Math.round(this.liveInterval() / MIN) : null,
        pressure: this.pressure(),
        focusEveryMin: Math.round(this.focusInterval() / MIN),
        otherEveryMin: Math.round(this.otherInterval() / MIN),
        focusMatches: this.list.filter((m) => this.focusLevel(m) > 0).map((m) => `${m.home.short}-${m.away.short} ${m.status}`),
      },
    };
  }

  async start() {
    await this.refreshList();
    const loopList = async () => {
      await this.refreshList().catch((e) => console.error('[matches] liste hatası', e));
      this.listTimer = setTimeout(loopList, this.listInterval());
    };
    const loopDetail = async () => {
      await this.refreshWatched().catch((e) => console.error('[matches] detay hatası', e));
      this.detailTimer = setTimeout(loopDetail, this.provider.pollMs.detail);
    };
    const loopLive = async () => {
      let wait = MIN; // oynanan maç yokken istek atmadan dakikada bir bak
      if (this.liveFeedOn() && this.liveDue()) {
        await this.refreshLive().catch((e) => console.error('[matches] canlı akış hatası', e));
        wait = this.liveInterval();
      }
      this.liveTimer = setTimeout(loopLive, wait);
    };
    const loopFocus = async () => {
      await this.refreshFocus().catch((e) => console.error('[matches] öncelikli maç hatası', e));
      this.focusTimer = setTimeout(loopFocus, 30_000);
    };
    this.listTimer = setTimeout(loopList, this.listInterval());
    this.detailTimer = setTimeout(loopDetail, this.provider.pollMs.detail);
    this.liveTimer = setTimeout(loopLive, 5_000);
    this.focusTimer = setTimeout(loopFocus, 10_000);
    const loopClubs = async () => {
      await this.refreshClubs().catch((e) => console.error('[matches] takım fikstürü hatası', e));
      this.clubsTimer = setTimeout(loopClubs, 10 * MIN);
    };
    this.clubsTimer = setTimeout(loopClubs, 20_000);
    const loopExtra = async () => {
      await this.refreshTomorrow().catch((e) => console.error('[matches] yarının maçları hatası', e));
      await this.refreshYesterday().catch((e) => console.error('[matches] dünün maçları hatası', e));
      await this.refreshStandings().catch((e) => console.error('[matches] puan durumu hatası', e));
      this.extraTimer = setTimeout(loopExtra, 5 * MIN);
    };
    this.extraTimer = setTimeout(loopExtra, 30_000);
    // gece yarısı: liste boştayken 2 saatte bir yenilendiği için gün dönümü ayrıca yakalanır
    const loopDay = async () => {
      if (!this.provider.isDemo && this.listDay && this.listDay !== istanbulDay(0)) await this.rollover().catch((e) => console.error('[matches] gün dönümü hatası', e));
      this.dayTimer = setTimeout(loopDay, MIN);
    };
    this.dayTimer = setTimeout(loopDay, MIN);
  }

  /** Gün döndü: eski "yarın" ve "dün" listeleri artık yanlış güne ait; hepsi hemen yenilenir */
  private async rollover() {
    this.emit('tomorrow', null);
    this.emit('yesterday', null);
    await this.refreshList();
    await this.refreshTomorrow();
    await this.refreshYesterday();
  }

  stop() {
    clearTimeout(this.listTimer);
    clearTimeout(this.detailTimer);
    clearTimeout(this.liveTimer);
    clearTimeout(this.focusTimer);
    clearTimeout(this.clubsTimer);
    clearTimeout(this.extraTimer);
    clearTimeout(this.dayTimer);
  }

  getList() {
    return this.list;
  }

  /** null: henüz alınmadı (ya da sağlayıcı yarının listesini vermiyor) */
  getTomorrow() {
    // gün döndüyse eldeki liste artık "bugün"ün listesi: yenisi gelene kadar gösterme
    return this.tomorrowDay === istanbulDay(1) ? this.tomorrow : null;
  }

  /** null: henüz alınmadı (ya da sağlayıcı dünün listesini vermiyor) */
  getYesterday() {
    return this.yesterdayDay === istanbulDay(-1) ? this.yesterday : null;
  }

  getStandings() {
    return this.table;
  }

  // ------------------------------------------------------------ oyuncu profili

  private players = new Map<string, { at: number; p: PlayerProfile | null }>();
  private playerJobs = new Map<string, Promise<PlayerProfile | null>>();

  /** Oyuncu profili: oyuncu başına günde en fazla 1 istek (sezonda kaydı yoksa 2); kota sıkışıksa eldeki */
  async playerProfile(id: string): Promise<PlayerProfile | null> {
    if (!this.provider.playerProfile) return null;
    const now = Date.now();
    const hit = this.players.get(id);
    if (hit && now - hit.at < (hit.p ? 24 : 6) * 60 * MIN) return hit.p;
    if (this.pressure() === 'critical') return hit?.p ?? null;
    let job = this.playerJobs.get(id);
    if (!job) {
      job = this.provider.playerProfile(id).catch(() => null);
      this.playerJobs.set(id, job);
      job.finally(() => this.playerJobs.delete(id));
    }
    const p = await job;
    this.players.set(id, { at: now, p: p ?? hit?.p ?? null });
    if (this.players.size > 3000) for (const [k, v] of this.players) if (now - v.at > 24 * 60 * MIN) this.players.delete(k);
    return p ?? hit?.p ?? null;
  }

  /** Oyuncu bu maçın kadrosunda, muhtemel 11'inde ya da eksikler listesinde mi (rastgele kimliklerle kota harcatılmasın) */
  knowsPlayer(m: Match, playerId: string) {
    const ids = (side: 'home' | 'away') => [
      ...(m.lineups?.[side]?.startXI ?? []),
      ...(m.lineups?.[side]?.subs ?? []),
      ...(this.previews.get(m.id)?.p.xi[side]?.startXI ?? []),
      ...(this.previews.get(m.id)?.p.absent[side] ?? []),
    ];
    return [...ids('home'), ...ids('away')].some((x) => x.id === playerId);
  }

  // ------------------------------------------------------------ maç öncesi

  private previews = new Map<string, { at: number; p: Omit<MatchPreview, 'table'> }>();
  private previewJobs = new Map<string, Promise<Omit<MatchPreview, 'table'> | null>>();
  private leagueTables = new Map<string, { at: number; t: Standings | null }>();

  /** Başlamamış maçın ön bilgileri; başlamış maçta yalnızca eldeki gösterilir (yeni istek atılmaz) */
  async preview(m: MatchSummary): Promise<MatchPreview | null> {
    if (!this.provider.matchPreview) return null;
    const now = Date.now();
    const hit = this.previews.get(m.id);
    let p = hit?.p ?? null;
    const ttl = this.provider.isDemo || m.id.startsWith('demo-') ? MIN : 3 * 60 * MIN;
    if (m.status === 'SCHEDULED' && (!hit || now - hit.at > ttl) && this.pressure() !== 'critical') {
      // aynı maçı aynı anda açan herkes tek isteği bekler
      let job = this.previewJobs.get(m.id);
      if (!job) {
        job = this.provider.matchPreview(m).catch(() => null);
        this.previewJobs.set(m.id, job);
        job.finally(() => this.previewJobs.delete(m.id));
      }
      const fresh = await job;
      if (fresh) {
        this.previews.set(m.id, { at: now, p: (p = fresh) });
        // eski maçların ön bilgileri bellekte birikmesin
        for (const [id, v] of this.previews) if (now - v.at > 24 * 60 * MIN) this.previews.delete(id);
      }
    }
    if (!p) return null;
    const t = await this.leagueTable(m.competition.id).catch(() => null);
    const row = (id: string) => t?.rows.find((r) => r.team.id === id) ?? null;
    const table = t && (row(m.home.id) || row(m.away.id)) ? { league: t.league.name, home: row(m.home.id), away: row(m.away.id) } : null;
    // hakem maç günü belli olur: listede güncel hâli varsa onu kullan
    const referee = this.list.find((x) => x.id === m.id)?.referee ?? m.referee ?? p.referee;
    return { ...p, referee, table };
  }

  /** Maçın liginin puan durumu: lobideki lig hazırda; diğerleri 6 saatte bir (kupa gibi tablosuz ligler günde bir denenir) */
  private async leagueTable(leagueId?: string): Promise<Standings | null> {
    if (!leagueId || !this.provider.standings || this.provider.isDemo) return null;
    if (leagueId === this.standingsLeague && this.table) return this.table;
    const hit = this.leagueTables.get(leagueId);
    const ttl = hit?.t ? 6 * 60 * MIN : 24 * 60 * MIN;
    if (hit && Date.now() - hit.at < ttl) return hit.t;
    if (this.pressure() === 'critical') return hit?.t ?? null;
    const t = await this.provider.standings(leagueId).catch(() => null);
    this.leagueTables.set(leagueId, { at: Date.now(), t });
    return t;
  }

  /** API'ye istek atmadan eldeki bilgiden maç özeti (sayfa başlıkları ve site haritası için) */
  peek(id: string): MatchSummary | null {
    const d = this.details.get(id)?.match;
    if (d) {
      const { events, lineups, stats, ...summary } = d;
      return summary;
    }
    const clubs = [...this.clubs.values()].flatMap((c) => [c.next, c.last]).filter((m): m is MatchSummary => Boolean(m));
    return [...this.list, ...this.tomorrow, ...this.yesterday, ...clubs].find((m) => m.id === id) ?? null;
  }

  /** Site haritasındaki maçlar: bugün, yarın, dün ve Büyük 4'ün sıradaki maçları */
  knownMatches(): MatchSummary[] {
    const next = [...this.clubs.values()].map((c) => c.next).filter((m): m is MatchSummary => Boolean(m));
    return [...this.list, ...(this.getTomorrow() ?? []), ...(this.getYesterday() ?? []), ...next];
  }

  /** Öncelikli takımın bilinen sonraki/son maçı (bugünün listesinde yoksa lobi bunları gösterir) */
  clubFixtures(teamId: string): TeamFixtures | null {
    return this.clubs.get(teamId) ?? null;
  }

  async getMatch(id: string): Promise<Match | null> {
    const cached = this.details.get(id);
    if (cached && Date.now() - cached.fullAt < this.maxAge(cached.match)) return cached.match;
    if (!cached && !this.peek(id) && !this.mayFetchUnknown(id)) return null;
    // aynı maçı aynı anda açan herkes tek isteği bekler
    let job = this.detailJobs.get(id);
    if (!job) {
      job = this.fetchDetail(id);
      this.detailJobs.set(id, job);
      job.finally(() => this.detailJobs.delete(id)).catch(() => {});
    }
    const m = await job;
    if (!m && !cached) this.notFound.set(id, Date.now());
    return m;
  }

  /** Sağlayıcının "böyle bir maç yok" dediği kimlik (son 6 saatte) */
  isMissing(id: string) {
    const at = this.notFound.get(id);
    return at != null && Date.now() - at < 6 * 60 * MIN;
  }

  /**
   * Listede olmayan (eski ya da uydurma) maç kimliği için API'ye gidilsin mi?
   * Biri adrese rastgele numaralar yazarak günlük kotayı bitiremesin: yalnızca sayı biçimindeki kimlikler,
   * "yok" denen kimlik 6 saat tekrar sorulmaz, saatte en çok 30 yeni maç, kota sıkışıkken hiç.
   */
  private mayFetchUnknown(id: string) {
    if (!/^(\d{1,10}|demo-\d{1,4})$/.test(id)) return false;
    if (this.isMissing(id)) return false;
    if (this.provider.isDemo || id.startsWith('demo-')) return true;
    if (this.pressure() !== 'ok') return false;
    const now = Date.now();
    this.unknownFetches = this.unknownFetches.filter((t) => now - t < 60 * MIN);
    if (this.unknownFetches.length >= 30) return false;
    this.unknownFetches.push(now);
    if (this.notFound.size > 5000) this.notFound.clear();
    return true;
  }

  /** Tam detayın geçerlilik süresi: canlı akış skor/olayları taşıdığı için canlı maçta saatte bir yeter */
  private maxAge(m: Match) {
    if (this.provider.isDemo || m.id.startsWith('demo-')) return this.provider.pollMs.detail;
    if (m.status === 'FT' || m.status === 'POSTPONED') return 6 * 60 * MIN;
    if (m.status === 'SCHEDULED') {
      const until = Date.parse(m.kickoff) - Date.now();
      // kadrolar genelde maçtan ~1 saat önce açıklanır; öncelikli maçta açıklanana kadar 10 dk'da bir bak
      if (this.focusLevel(m) && until <= 75 * MIN && !m.lineups) return 10 * MIN;
      return until > 90 * MIN ? 60 * MIN : 15 * MIN;
    }
    if (!this.liveFeedOn()) return this.provider.pollMs.detail;
    return this.focusLevel(m) ? this.focusInterval() : this.otherInterval();
  }

  watch(id: string) {
    this.watched.set(id, (this.watched.get(id) ?? 0) + 1);
  }
  unwatch(id: string) {
    const n = (this.watched.get(id) ?? 1) - 1;
    if (n <= 0) this.watched.delete(id);
    else this.watched.set(id, n);
  }

  // ------------------------------------------------------------ takım profili

  /** İstemcinin sorduğu takım sitede görünüyor mu (rastgele kimliklerle kota harcatılmasın) */
  knowsTeam(id: string) {
    const has = (m?: MatchSummary | null) => Boolean(m && (m.home.id === id || m.away.id === id));
    if ([...this.list, ...this.tomorrow, ...this.yesterday].some(has)) return true;
    if ([...this.details.values()].some((d) => has(d.match))) return true;
    if (this.focus.has(id) || [...this.clubs.values()].some((c) => has(c.next) || has(c.last))) return true;
    return Boolean(this.table?.rows.some((r) => r.team.id === id));
  }

  /**
   * Takım profili: 3 saatte bir (ya da bilinen sıradaki maçı bittiyse) yenilenir; kota sıkışıksa eldeki gösterilir.
   * Bugünün/dünün listesindeki maçlar güncel hâliyle yansır; oynanan maç sıradakilerden son maçlara geçer.
   */
  async teamProfile(id: string): Promise<(TeamProfile & { standing: (StandingRow & { league: string }) | null }) | null> {
    if (!this.provider.teamProfile) return null;
    const now = Date.now();
    const hit = this.profiles.get(id);
    // bilinen sıradaki maç profil alındıktan sonra bittiyse yenile (alınırken zaten geçmişse tekrar tekrar isteme)
    const end = hit?.p.next[0] ? Date.parse(hit.p.next[0].kickoff) + 150 * MIN : 0;
    const nextOver = Boolean(hit && end > hit.at && end < now);
    const ttl = this.provider.isDemo ? MIN : 3 * 60 * MIN;
    let p = hit?.p ?? null;
    if ((!hit || now - hit.at > ttl || nextOver) && this.pressure() !== 'critical') {
      // aynı takımı aynı anda açan herkes tek isteği bekler
      let job = this.profileJobs.get(id);
      if (!job) {
        job = this.provider.teamProfile(id).catch(() => null);
        this.profileJobs.set(id, job);
        job.finally(() => this.profileJobs.delete(id));
      }
      const fresh = await job;
      if (fresh) this.profiles.set(id, { at: now, p: (p = fresh) });
    }
    if (!p) return null;
    const cur = (m: MatchSummary) => this.list.find((x) => x.id === m.id) ?? this.yesterday.find((x) => x.id === m.id) ?? m;
    const seen = new Set<string>();
    const all = [...p.next, ...p.last].map(cur).filter((m) => !m.id || (!seen.has(m.id) && seen.add(m.id)));
    const played = (m: MatchSummary) => m.status === 'LIVE' || m.status === 'HT' || m.status === 'FT';
    const row = this.table?.rows.find((r) => r.team.id === id);
    return {
      ...p,
      last: all.filter(played).sort((a, b) => b.kickoff.localeCompare(a.kickoff)).slice(0, 5),
      next: all.filter((m) => !played(m) && !(m.status === 'POSTPONED' && Date.parse(m.kickoff) < now)).sort((a, b) => a.kickoff.localeCompare(b.kickoff)).slice(0, 3),
      standing: row ? { ...row, league: this.table!.league.name } : null,
    };
  }

  // ------------------------------------------------------------ kota bütçesi

  private liveFeedOn() {
    return typeof this.provider.liveMatches === 'function' && !this.provider.isDemo;
  }

  /** Oynanan ya da başlama saati gelmiş maç var mı (istek atmadan, listeden) */
  private liveDue() {
    const now = Date.now();
    return this.list.some((m) => m.status === 'LIVE' || m.status === 'HT' || (m.status === 'SCHEDULED' && Date.parse(m.kickoff) <= now + MIN));
  }

  /** Bugünün son maçının tahmini bitişi */
  private windowEnd() {
    const open = this.list.filter((m) => m.status !== 'FT' && m.status !== 'POSTPONED');
    if (!open.length) return Date.now();
    return Math.max(...open.map((m) => Date.parse(m.kickoff))) + 130 * MIN;
  }

  /** Canlı akışa ayrılabilecek istek sayısı ve kalan süre */
  private budget() {
    const q = (this.provider as any).quota?.();
    if (!q) return null;
    const left = (q.remaining ?? q.limit - q.used) - (q.reserve ?? 5);
    const open = this.list.filter((m) => m.status !== 'FT' && m.status !== 'POSTPONED');
    const until = Math.max(MIN, Math.min(this.windowEnd(), Date.parse(q.resetsAt)) - Date.now());
    // diğer harcamalar için ayır: diğer maç başına ~2 tam detay (kadro + bitiş), öncelikli maçlar için
    // kalan süreleri boyunca detay yenilemeleri + kadro kontrolü, saatte bir liste
    const focusNeed = open
      .filter((m) => this.focusLevel(m))
      .reduce((a, m) => a + 8 + Math.ceil(Math.max(0, Date.parse(m.kickoff) + 130 * MIN - Date.now()) / this.focusInterval(true)), 0);
    const others = open.filter((m) => !this.focusLevel(m)).length * 2 + focusNeed + Math.ceil(until / (60 * MIN));
    return { left, forLive: left - others, until };
  }

  /**
   * Kota baskısı: kalan hak, günün kalan kısmına düşen paya göre.
   * ok: rahat · tight: diğer maçlar yavaşlar · critical: öncelikli maçlar da yavaşlar
   */
  private pressure(): 'ok' | 'tight' | 'critical' {
    const q = (this.provider as any).quota?.();
    if (!q) return 'ok';
    const left = (q.remaining ?? q.limit - q.used) - (q.reserve ?? 5);
    const dayLeft = Math.max(0.05, (Date.parse(q.resetsAt) - Date.now()) / (24 * 60 * MIN));
    const ratio = left / (q.limit * dayLeft);
    return ratio < 0.2 ? 'critical' : ratio < 0.5 ? 'tight' : 'ok';
  }

  /** Öncelikli canlı maçların tam detay aralığı (base: baskıyı hesaba katmadan, bütçe tahmini için) */
  private focusInterval(base = false) {
    const p = base ? 'ok' : this.pressure();
    return this.focusDetailMs * (p === 'critical' ? 10 : p === 'tight' ? 3 : 1);
  }

  /** Diğer (izlenen) canlı maçların tam detay aralığı */
  private otherInterval() {
    const p = this.pressure();
    return p === 'critical' ? 6 * 60 * MIN : p === 'tight' ? Math.min(3 * 60 * MIN, this.otherDetailMs * 3) : this.otherDetailMs;
  }

  private liveInterval() {
    const base = this.provider.pollMs.live ?? this.provider.pollMs.detail;
    const b = this.budget();
    if (!b) return base;
    if (b.forLive <= 0) return 30 * MIN;
    return Math.min(30 * MIN, Math.max(base, Math.ceil(b.until / b.forLive)));
  }

  private listInterval() {
    const base = this.provider.pollMs.list;
    // canlı akış açıkken liste yalnızca yeni maçları/saat değişikliklerini yakalamak için
    if (this.liveFeedOn() && this.liveDue()) return Math.max(base, this.pressure() === 'ok' ? 15 * MIN : 60 * MIN);
    const b = this.budget();
    if (b && b.left < 15) return Math.max(base, 2 * 60 * MIN);
    return base;
  }

  // ------------------------------------------------------------ yenileme

  private async refreshList() {
    const day = istanbulDay(0);
    const list = await this.provider.listMatches();
    this.listDay = day;
    // gün dönünce yeni listede dünün maçları yok: gece yarısını geçip hâlâ oynanan maç bitene kadar Bugün'de kalsın
    if (!this.provider.isDemo) {
      const ids = new Set(list.map((m) => m.id));
      for (const m of [...this.list, ...this.yesterday]) {
        if ((m.status === 'LIVE' || m.status === 'HT') && !m.id.startsWith('demo-') && !ids.has(m.id)) {
          ids.add(m.id);
          list.push(m);
        }
      }
    }
    const order = { LIVE: 0, HT: 0, SCHEDULED: 1, FT: 2, POSTPONED: 3 } as const;
    // aynı durumdaki maçlarda öncelikli takımların maçları (ve ligleri) üstte
    list.sort((a, b) => order[a.status] - order[b.status] || this.focusLevel(b) - this.focusLevel(a) || a.kickoff.localeCompare(b.kickoff));
    const info = this.providerInfo;
    const json = JSON.stringify(list) + `|${info.demo}|${info.stale}`; // sağlayıcı durumu değişince de yayınla
    if (json !== this.listJson) {
      this.list = list;
      this.listJson = json;
      this.emit('list', list);
    }
  }

  private async refreshLive() {
    const live = await this.provider.liveMatches!();
    if (!live) return;
    const ids = new Set<string>();
    for (const m of live) {
      if (!this.list.some((x) => x.id === m.id)) continue;
      ids.add(m.id);
      const prev = this.details.get(m.id);
      // canlı akışta kadro/istatistik yok: öncekileri koru
      this.ingest({ ...m, lineups: prev?.match.lineups, stats: prev?.match.stats ?? [] }, prev?.fullAt ?? 0);
    }
    // listede canlı görünüp akışta olmayan maçlar bitti (ya da yarıda kaldı): son durumu ve istatistikleri bir kez çek
    const recent = (id: string) => Date.now() - (this.details.get(id)?.fullAt ?? 0) < 15 * MIN;
    const ended = this.list.filter((m) => (m.status === 'LIVE' || m.status === 'HT') && !ids.has(m.id) && !recent(m.id)).map((m) => m.id);
    for (const id of ended) await this.fetchDetail(id);
  }

  /** Öncelikli maçlar: kimse izlemese de kadroyu erken çek, canlıyken tam detayı sık yenile (oda hazır olsun) */
  private async refreshFocus() {
    if (!this.focus.size || !this.liveFeedOn()) return;
    const now = Date.now();
    for (const m of this.list) {
      if (!this.focusLevel(m)) continue;
      const cached = this.details.get(m.id);
      const age = now - (cached?.fullAt ?? 0);
      const until = Date.parse(m.kickoff) - now;
      const due =
        m.status === 'LIVE' || m.status === 'HT'
          ? age >= this.focusInterval()
          : m.status === 'SCHEDULED' && until <= 75 * MIN && until > -10 * MIN && !cached?.match.lineups && age >= 10 * MIN;
      if (due) await this.fetchDetail(m.id);
    }
  }

  private async refreshClubs() {
    if (!this.focus.size || !this.provider.teamFixtures || this.provider.isDemo || this.pressure() === 'critical') return;
    const now = Date.now();
    // bilinen sonraki maç bittiyse (ör. dün akşam) yenisini öğren; yoksa 6 saatte bir
    const ended = [...this.clubs.values()].some((c) => c.next && Date.parse(c.next.kickoff) + 150 * MIN < now && this.clubsAt < Date.parse(c.next.kickoff) + 150 * MIN);
    if (this.clubsAt && now - this.clubsAt < 6 * 60 * MIN && !ended) return;
    let got = 0;
    for (const id of this.focus) {
      const fx = await this.provider.teamFixtures(id);
      if (!fx) continue;
      this.clubs.set(id, fx);
      got++;
    }
    if (!got) return; // alınamadı: 10 dk sonra tekrar dene
    this.clubsAt = now;
    const json = JSON.stringify([...this.clubs]);
    if (json !== this.clubsJson) {
      this.clubsJson = json;
      this.emit('clubs');
    }
  }

  /** Yarının maçları: saatte bir; gün dönünce (dünün "yarın"ı bugün olunca) hemen */
  private async refreshTomorrow() {
    if (!this.provider.tomorrowMatches || this.provider.isDemo || this.pressure() === 'critical') return;
    const day = istanbulDay(1);
    if (this.tomorrowDay === day && Date.now() - this.tomorrowAt < 60 * MIN) return;
    const list = await this.provider.tomorrowMatches();
    if (!list) return;
    const changed = this.tomorrowDay !== day || JSON.stringify(list) !== JSON.stringify(this.tomorrow);
    this.tomorrow = list;
    this.tomorrowDay = day;
    this.tomorrowAt = Date.now();
    if (changed) this.emit('tomorrow', list);
  }

  /** Dünün maçları: gün dönünce bir kez (biten maçlar değişmez; süren maç patchList ile güncellenir) */
  private async refreshYesterday() {
    if (!this.provider.yesterdayMatches || this.provider.isDemo || this.pressure() === 'critical') return;
    const day = istanbulDay(-1);
    if (this.yesterdayDay === day) return;
    const list = await this.provider.yesterdayMatches();
    if (!list) return;
    // bugünün listesinde daha güncel hâli olan maç (gece yarısını geçen) oradan alınır
    this.yesterday = list.map((m) => this.list.find((x) => x.id === m.id) ?? m);
    this.yesterdayDay = day;
    this.emit('yesterday', this.yesterday);
  }

  /**
   * Tarih seçici: bugünden 7 gün geri ve 7 gün ileriye kadar herhangi bir günün maçları.
   * Dün/bugün/yarın zaten elde; diğer günler ilk istendiğinde tek istekle çekilir ve saklanır
   * (geçmiş gün 6 saat, gelecek gün 1 saat). Kota sıkışıkken yeni gün çekilmez.
   */
  async getDay(date: string): Promise<MatchSummary[] | null> {
    if (date === istanbulDay(0)) return this.list;
    if (date === istanbulDay(1) && this.tomorrowDay === date) return this.tomorrow;
    if (date === istanbulDay(-1) && this.yesterdayDay === date) return this.yesterday;
    const allowed = new Set(Array.from({ length: 15 }, (_, i) => istanbulDay(i - 7)));
    if (!allowed.has(date)) return null;
    const hit = this.days.get(date);
    const ttl = date < istanbulDay(0) ? 6 * 60 * MIN : 60 * MIN;
    if (hit && Date.now() - hit.at < ttl) return hit.list;
    if (!this.provider.dayMatches || this.pressure() === 'critical') return hit?.list ?? null;
    let job = this.dayJobs.get(date);
    if (!job) {
      job = this.provider.dayMatches(date).catch(() => null);
      this.dayJobs.set(date, job);
      job.finally(() => this.dayJobs.delete(date)).catch(() => {});
    }
    const list = await job;
    if (!list) return hit?.list ?? null;
    for (const d of this.days.keys()) if (!allowed.has(d)) this.days.delete(d);
    this.days.set(date, { at: Date.now(), list });
    return list;
  }
  /**
   * Bugün maç yoksa ana sayfada gösterilecek sıradaki maç günü (yarından 7 gün ileriye kadar ilk dolu gün).
   * Yarın elde; sonraki günler getDay önbelleğinden, ilk aramada gün başına 1 istek (en çok 6, saatte bir).
   */
  async nextMatchDay(): Promise<{ date: string; matches: MatchSummary[] } | null> {
    for (let i = 1; i <= 7; i++) {
      const date = istanbulDay(i);
      const list = await this.getDay(date).catch(() => null);
      if (list?.length) return { date, matches: list };
    }
    return null;
  }
  private days = new Map<string, { at: number; list: MatchSummary[] }>();
  private dayJobs = new Map<string, Promise<MatchSummary[] | null>>();

  /** Puan durumu: 3 saatte bir; ligde bugün yeni bir maç bitince 10 dk sonra */
  private async refreshStandings() {
    if (!this.standingsLeague || !this.provider.standings || this.provider.isDemo || this.pressure() === 'critical') return;
    const now = Date.now();
    const ft = this.list.filter((m) => m.competition.id === this.standingsLeague && m.status === 'FT').map((m) => m.id);
    const fresh = ft.some((id) => !this.tableSeen.has(id));
    // API tabloyu maç bitiminden biraz sonra günceller: yeni biten maçtan 10 dk sonra çek
    const due = !this.tableAt || now - this.tableAt > 3 * 60 * MIN || (fresh && now - this.tableAt > 10 * MIN);
    if (!due) return;
    const table = await this.provider.standings(this.standingsLeague);
    if (!table) return;
    const changed = JSON.stringify(table.rows) !== JSON.stringify(this.table?.rows);
    this.table = table;
    this.tableAt = now;
    this.tableSeen = new Set(ft);
    if (changed) this.emit('standings', table);
  }

  private async refreshWatched() {
    for (const id of this.watched.keys()) {
      const summary = this.list.find((m) => m.id === id);
      const cached = this.details.get(id);
      // önbellek tazeyse ve listedeki durum değişmediyse istek atma
      const fresh = cached && Date.now() - cached.fullAt < this.maxAge(cached.match) - 5_000;
      if (fresh && (!summary || summary.status === cached.match.status)) continue;
      await this.fetchDetail(id);
    }
  }

  /** Detaydan gelen skor/dakika/durumu listeye de yansıt (lobi ek istek olmadan güncel kalır) */
  private patchList(m: Match) {
    const { events, lineups, stats, ...summary } = m;
    // dünün listesindeki maç (gece yarısını geçen ya da sonradan açılan) da güncel kalsın
    const y = this.yesterday.findIndex((x) => x.id === m.id);
    if (y >= 0) {
      const next = { ...this.yesterday[y], ...summary };
      if (JSON.stringify(next) !== JSON.stringify(this.yesterday[y])) {
        this.yesterday = this.yesterday.map((x, j) => (j === y ? next : x));
        if (this.yesterdayDay === istanbulDay(-1)) this.emit('yesterday', this.yesterday);
      }
    }
    const i = this.list.findIndex((x) => x.id === m.id);
    if (i < 0) return;
    const next = { ...this.list[i], ...summary };
    if (JSON.stringify(next) === JSON.stringify(this.list[i])) return;
    this.list = this.list.map((x, j) => (j === i ? next : x));
    const info = this.providerInfo;
    this.listJson = JSON.stringify(this.list) + `|${info.demo}|${info.stale}`;
    this.emit('list', this.list);
  }

  /** Eski maçların detayları bellekte birikmesin: izlenmeyen ve listede olmayan en eskileri bırak */
  private pruneDetails() {
    const keep = new Set([...this.list, ...this.tomorrow, ...this.yesterday].map((m) => m.id));
    const old = [...this.details.entries()]
      .filter(([id]) => !keep.has(id) && !this.watched.has(id))
      .sort((a, b) => a[1].fullAt - b[1].fullAt)
      .slice(0, 300);
    for (const [id] of old) this.details.delete(id);
  }

  private async fetchDetail(id: string): Promise<Match | null> {
    const match = await this.provider.getMatch(id);
    if (!match) {
      // sağlayıcı yanıt veremediyse (ör. kota doldu) son detayı ya da listedeki özeti göster
      const prev = this.details.get(id)?.match;
      if (prev) return prev;
      const summary = this.list.find((m) => m.id === id);
      return summary ? { ...summary, events: [], stats: [] } : null;
    }
    this.ingest(match, Date.now());
    return match;
  }

  private ingest(match: Match, fullAt: number) {
    const json = JSON.stringify(match);
    const prev = this.details.get(match.id);
    this.details.set(match.id, { match, json, fullAt });
    if (this.details.size > 1500) this.pruneDetails();
    this.patchList(match);
    if (prev && prev.json !== json) {
      const seen = new Set(prev.match.events.map((e) => e.id));
      const fresh: MatchEvent[] = match.events.filter((e) => !seen.has(e.id));
      this.emit('match', match);
      if (fresh.length) this.emit('events', match.id, fresh, match);
      if (prev.match.status !== match.status) this.emit('status', match, prev.match.status);
    }
  }
}
