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
    return { name: this.provider.name, demo: this.provider.isDemo, error: (this.provider as any).lastError ?? null };
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

  async getMatch(id: string, maxAgeMs = 5_000): Promise<Match | null> {
    const cached = this.details.get(id);
    if (cached && Date.now() - cached.at < Math.max(maxAgeMs, this.provider.pollMs.detail)) return cached.match;
    return this.fetchDetail(id);
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
    const json = JSON.stringify(list);
    if (json !== this.listJson) {
      this.list = list;
      this.listJson = json;
      this.emit('list', list);
    }
  }

  private async refreshWatched() {
    for (const id of this.watched.keys()) {
      const summary = this.list.find((m) => m.id === id);
      // biten / ertelenen maçları gereksiz yere yoklama
      const cached = this.details.get(id);
      if (cached && summary && (summary.status === 'FT' || summary.status === 'POSTPONED') && cached.match.status === summary.status) continue;
      await this.fetchDetail(id);
    }
  }

  private async fetchDetail(id: string): Promise<Match | null> {
    const match = await this.provider.getMatch(id);
    if (!match) return this.details.get(id)?.match ?? null;
    const json = JSON.stringify(match);
    const prev = this.details.get(id);
    this.details.set(id, { match, json, at: Date.now() });
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
