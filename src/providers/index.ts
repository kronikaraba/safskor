import { config } from '../config.js';
import type { FootballProvider, Match, MatchSummary } from '../types.js';
import { ApiFootballProvider, PlanError, QuotaError } from './apiFootball.js';
import { DemoProvider } from './demo.js';

/**
 * Gerçek sağlayıcıyı sarar:
 * - Günlük kota dolarsa demoya geçmez; son alınan gerçek veriyi göstermeye devam eder (stale).
 * - Anahtar/plan hatasında (ör. plan güncel sezonu kapsamıyor) demoya geçer ve 6 saat sonra tekrar dener.
 * - Geçici hatada (ağ, 5xx) demoya geçer ve 10 dakika sonra tekrar dener.
 */
export class FallbackProvider implements FootballProvider {
  readonly name: string;
  private failedUntil = 0;
  private lastList: MatchSummary[] = [];
  lastError: string | null = null;
  stale = false;

  constructor(
    private primary: ApiFootballProvider,
    private demo: DemoProvider,
  ) {
    this.name = primary.name;
  }

  get isDemo() {
    return Date.now() < this.failedUntil;
  }
  get pollMs() {
    if (this.isDemo) return this.demo.pollMs;
    const p = this.primary.pollMs;
    // kota doluyken boşuna sık dönme; gün dönümünü yakalayacak kadar seyrek kontrol et
    return this.stale ? { list: 30 * 60_000, detail: 30 * 60_000 } : p;
  }
  quota() {
    return this.primary.quota();
  }

  /** true: son gerçek veriyle devam et; false: demoya geç */
  private handle(err: unknown): boolean {
    this.lastError = err instanceof Error ? err.message : String(err);
    if (err instanceof QuotaError) {
      if (!this.stale) console.warn(`[provider] ${this.lastError}; son alınan veriler gösteriliyor`);
      this.stale = true;
      if (this.lastList.length) return true;
      this.failedUntil = Date.parse(this.primary.quota().resetsAt);
    } else {
      this.failedUntil = Date.now() + (err instanceof PlanError ? 6 * 60 * 60_000 : 10 * 60_000);
    }
    this.demo.start();
    console.warn(`[provider] ${this.primary.name} kullanılamıyor, demo verisine geçiliyor: ${this.lastError}`);
    return false;
  }

  async listMatches(): Promise<MatchSummary[]> {
    if (!this.isDemo) {
      try {
        const list = await this.primary.listMatches();
        this.lastError = null;
        this.stale = false;
        this.lastList = list;
        return list;
      } catch (e) {
        if (this.handle(e)) return this.lastList;
      }
    }
    return this.demo.listMatches();
  }

  async liveMatches(): Promise<Match[] | null> {
    if (this.isDemo || this.stale) return null;
    try {
      return await this.primary.liveMatches();
    } catch (e) {
      this.handle(e);
      return null;
    }
  }

  async getMatch(id: string): Promise<Match | null> {
    if (id.startsWith('demo-')) return this.demo.getMatch(id);
    if (this.isDemo) return null;
    try {
      return await this.primary.getMatch(id);
    } catch (e) {
      this.handle(e);
      return null;
    }
  }
}

export function createProvider(): FootballProvider & { lastError?: string | null } {
  const demo = new DemoProvider(config.demoTickMs);
  const wantsApi = config.provider === 'api-football' || (config.provider === 'auto' && config.apiFootball.key);
  if (!wantsApi) {
    demo.start();
    console.log('[provider] API anahtarı yok → demo veri sağlayıcısı kullanılıyor');
    return demo;
  }
  if (!config.apiFootball.key) {
    console.warn('[provider] DATA_PROVIDER=api-football fakat API_FOOTBALL_KEY boş → demo veri');
    demo.start();
    return demo;
  }
  console.log('[provider] API-Football kullanılıyor (hata durumunda demo veriye düşer)');
  return new FallbackProvider(new ApiFootballProvider(config.apiFootball), demo);
}
