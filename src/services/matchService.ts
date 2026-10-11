import { EventEmitter } from 'node:events';
import type { FootballProvider, Match, MatchEvent, MatchSummary, TeamFixtures } from '../types.js';

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
 *
 * Olaylar: 'list' (MatchSummary[]), 'match' (Match), 'events' (matchId, MatchEvent[] yeni olaylar), 'clubs'
 */
export class MatchService extends EventEmitter {
  private list: MatchSummary[] = [];
  private listJson = '';
  /** fullAt: son tam detay (kadro/istatistik) çekimi; canlı akış güncellemeleri bunu değiştirmez */
  private details = new Map<string, { match: Match; json: string; fullAt: number }>();
  private watched = new Map<string, number>();
  private listTimer?: NodeJS.Timeout;
  private detailTimer?: NodeJS.Timeout;
  private liveTimer?: NodeJS.Timeout;
  private focusTimer?: NodeJS.Timeout;
  private clubsTimer?: NodeJS.Timeout;
  private clubs = new Map<string, TeamFixtures>();
  private clubsAt = 0;
  private clubsJson = '';
  private focus: Set<string>;
  private focusDetailMs: number;
  private otherDetailMs: number;

  constructor(
    private provider: FootballProvider,
    opts: { teams?: string[]; detailMs?: number; otherDetailMs?: number } = {},
  ) {
    super();
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
  }

  stop() {
    clearTimeout(this.listTimer);
    clearTimeout(this.detailTimer);
    clearTimeout(this.liveTimer);
    clearTimeout(this.focusTimer);
    clearTimeout(this.clubsTimer);
  }

  getList() {
    return this.list;
  }

  /** Öncelikli takımın bilinen sonraki/son maçı (bugünün listesinde yoksa lobi bunları gösterir) */
  clubFixtures(teamId: string): TeamFixtures | null {
    return this.clubs.get(teamId) ?? null;
  }

  async getMatch(id: string): Promise<Match | null> {
    const cached = this.details.get(id);
    if (cached && Date.now() - cached.fullAt < this.maxAge(cached.match)) return cached.match;
    return this.fetchDetail(id);
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
    const list = await this.provider.listMatches();
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
    const i = this.list.findIndex((x) => x.id === m.id);
    if (i < 0) return;
    const { events, lineups, stats, ...summary } = m;
    const next = { ...this.list[i], ...summary };
    if (JSON.stringify(next) === JSON.stringify(this.list[i])) return;
    this.list = this.list.map((x, j) => (j === i ? next : x));
    const info = this.providerInfo;
    this.listJson = JSON.stringify(this.list) + `|${info.demo}|${info.stale}`;
    this.emit('list', this.list);
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
