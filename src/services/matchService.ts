import { EventEmitter } from 'node:events';
import type { FootballProvider, Match, MatchEvent, MatchSummary } from '../types.js';

/**
 * Sağlayıcıyı yoklar, sonuçları önbelleğe alır ve değişiklikleri olay olarak yayar.
 * Ayrıntılar yalnızca izleyicisi olan maçlar için çekilir (API kotasını korur).
 *
 * Olaylar: 'list' (MatchSummary[]), 'match' (Match), 'events' (matchId, MatchEvent[] yeni olaylar)
 */
export class MatchService extends EventEmitter {
  private list: MatchSummary[] = [];
  private listJson = '';
  private details = new Map<string, { match: Match; json: string; at: number }>();
  private watched = new Map<string, number>();
  private listTimer?: NodeJS.Timeout;
  private detailTimer?: NodeJS.Timeout;

  constructor(private provider: FootballProvider) {
    super();
  }

  get providerInfo() {
    const p = this.provider as any;
    return {
      name: this.provider.name,
      demo: this.provider.isDemo,
      error: p.lastError ?? null,
      stale: Boolean(p.stale),
      quota: typeof p.quota === 'function' ? p.quota() : null,
    };
  }

  async start() {
    await this.refreshList();
    const loopList = async () => {
      await this.refreshList().catch((e) => console.error('[matches] liste hatası', e));
      this.listTimer = setTimeout(loopList, this.provider.pollMs.list);
    };
    const loopDetail = async () => {
      await this.refreshWatched().catch((e) => console.error('[matches] detay hatası', e));
      this.detailTimer = setTimeout(loopDetail, this.provider.pollMs.detail);
    };
    this.listTimer = setTimeout(loopList, this.provider.pollMs.list);
    this.detailTimer = setTimeout(loopDetail, this.provider.pollMs.detail);
  }

  stop() {
    clearTimeout(this.listTimer);
    clearTimeout(this.detailTimer);
  }

  getList() {
    return this.list;
  }

  async getMatch(id: string): Promise<Match | null> {
    const cached = this.details.get(id);
    if (cached && Date.now() - cached.at < this.maxAge(cached.match)) return cached.match;
    return this.fetchDetail(id);
  }

  /** Önbellek süresi maç durumuna göre: canlıda yoklama aralığı, bitmiş maçta saatler (API kotasını korur) */
  private maxAge(m: Match) {
    if (this.provider.isDemo || m.id.startsWith('demo-')) return this.provider.pollMs.detail;
    if (m.status === 'FT' || m.status === 'POSTPONED') return 6 * 60 * 60_000;
    if (m.status === 'SCHEDULED') {
      const until = Date.parse(m.kickoff) - Date.now();
      // kadrolar genelde maçtan ~1 saat önce açıklanır
      return until > 90 * 60_000 ? 60 * 60_000 : 15 * 60_000;
    }
    return this.provider.pollMs.detail;
  }

  watch(id: string) {
    this.watched.set(id, (this.watched.get(id) ?? 0) + 1);
  }
  unwatch(id: string) {
    const n = (this.watched.get(id) ?? 1) - 1;
    if (n <= 0) this.watched.delete(id);
    else this.watched.set(id, n);
  }

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

  private async refreshWatched() {
    for (const id of this.watched.keys()) {
      const summary = this.list.find((m) => m.id === id);
      const cached = this.details.get(id);
      // önbellek tazeyse ve listedeki durum değişmediyse istek atma
      const fresh = cached && Date.now() - cached.at < this.maxAge(cached.match) - 5_000;
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
    const json = JSON.stringify(match);
    const prev = this.details.get(id);
    this.details.set(id, { match, json, at: Date.now() });
    this.patchList(match);
    if (prev && prev.json !== json) {
      const seen = new Set(prev.match.events.map((e) => e.id));
      const fresh: MatchEvent[] = match.events.filter((e) => !seen.has(e.id));
      this.emit('match', match);
      if (fresh.length) this.emit('events', id, fresh, match);
      if (prev.match.status !== match.status) this.emit('status', match, prev.match.status);
    }
    return match;
  }
}
