import { EventEmitter } from 'node:events';
import type { FootballProvider, Match, MatchEvent, MatchSummary } from '../types.js';

const MIN = 60_000;

/**
 * Sağlayıcıyı yoklar, sonuçları önbelleğe alır ve değişiklikleri olay olarak yayar.
 *
 * Kota bütçesi (sağlayıcı liveMatches destekliyorsa):
 * - Oynanan tüm maçların skoru, dakikası ve olayları tek istekte gelir ("canlı akış"); maç başına istek atılmaz.
 * - Kadro/istatistik için tam detay yalnızca izleyicisi olan maçlarda, seyrek çekilir; maç bitince bir kez daha.
 * - Canlı akış ve liste aralıkları kalan hakka göre ayarlanır: kalan istekler günün son maçının bitişine kadar
 *   eşit yayılır, böylece kota gün içinde tükenmez (bütçe bolsa alt sınırlar kullanılır).
 *
 * Olaylar: 'list' (MatchSummary[]), 'match' (Match), 'events' (matchId, MatchEvent[] yeni olaylar)
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

  constructor(private provider: FootballProvider) {
    super();
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
    this.listTimer = setTimeout(loopList, this.listInterval());
    this.detailTimer = setTimeout(loopDetail, this.provider.pollMs.detail);
    this.liveTimer = setTimeout(loopLive, 5_000);
  }

  stop() {
    clearTimeout(this.listTimer);
    clearTimeout(this.detailTimer);
    clearTimeout(this.liveTimer);
  }

  getList() {
    return this.list;
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
      // kadrolar genelde maçtan ~1 saat önce açıklanır
      return until > 90 * MIN ? 60 * MIN : 15 * MIN;
    }
    return this.liveFeedOn() ? 60 * MIN : this.provider.pollMs.detail;
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
    const left = (q.remaining ?? q.limit - q.used) - 5;
    const open = this.list.filter((m) => m.status !== 'FT' && m.status !== 'POSTPONED');
    const until = Math.max(MIN, Math.min(this.windowEnd(), Date.parse(q.resetsAt)) - Date.now());
    // diğer harcamalar için ayır: maç başına ~2 tam detay (izlenirse kadro + bitiş), saatte bir liste
    const others = open.length * 2 + Math.ceil(until / (60 * MIN));
    return { left, forLive: left - others, until };
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
    if (this.liveFeedOn() && this.liveDue()) return Math.max(base, 60 * MIN);
    const b = this.budget();
    if (b && b.left < 15) return Math.max(base, 2 * 60 * MIN);
    return base;
  }

  // ------------------------------------------------------------ yenileme

  private async refreshList() {
    const list = await this.provider.listMatches();
    const order = { LIVE: 0, HT: 0, SCHEDULED: 1, FT: 2, POSTPONED: 3 } as const;
    list.sort((a, b) => order[a.status] - order[b.status] || a.kickoff.localeCompare(b.kickoff));
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
