import { config } from '../config.js';
import type { FootballProvider, Match, MatchSummary } from '../types.js';
import { ApiFootballProvider } from './apiFootball.js';
import { DemoProvider } from './demo.js';

/**
 * Gerçek sağlayıcıyı sarar; hata olursa (anahtar geçersiz, kota doldu, ağ yok)
 * otomatik olarak demo verisine düşer ve bir süre sonra gerçek API'yi tekrar dener.
 */
export class FallbackProvider implements FootballProvider {
  readonly name: string;
  private failedUntil = 0;
  lastError: string | null = null;

  constructor(
    private primary: FootballProvider,
    private demo: DemoProvider,
    private retryMs = 5 * 60_000,
  ) {
    this.name = primary.name;
  }

  get isDemo() {
    return Date.now() < this.failedUntil;
  }
  get pollMs() {
    return this.isDemo ? this.demo.pollMs : this.primary.pollMs;
  }

  private fail(err: unknown) {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.failedUntil = Date.now() + this.retryMs;
    this.demo.start();
    console.warn(`[provider] ${this.primary.name} başarısız, demo verisine geçiliyor: ${this.lastError}`);
  }

  async listMatches(): Promise<MatchSummary[]> {
    if (!this.isDemo) {
      try {
        const list = await this.primary.listMatches();
        this.lastError = null;
        return list;
      } catch (e) {
        this.fail(e);
      }
    }
    return this.demo.listMatches();
  }

  async getMatch(id: string): Promise<Match | null> {
    if (id.startsWith('demo-')) return this.demo.getMatch(id);
    if (this.isDemo) return null;
    try {
      return await this.primary.getMatch(id);
    } catch (e) {
      this.fail(e);
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
