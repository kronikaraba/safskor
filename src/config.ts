import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  provider: (process.env.DATA_PROVIDER || 'auto') as 'auto' | 'demo' | 'api-football',
  apiFootball: {
    key: process.env.API_FOOTBALL_KEY?.trim() || '',
    baseUrl: process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io',
    leagues: (process.env.API_FOOTBALL_LEAGUES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Varsayılanlar API-Football ücretsiz planına (günde 100 istek) göre ayarlı.
    /** Canlı ya da 30 dk içinde başlayacak maç varken liste yoklama aralığı */
    listPollMs: num(process.env.LIST_POLL_MS, 20 * 60_000),
    /** Hiç canlı/yaklaşan maç yokken liste yoklama aralığı */
    listIdlePollMs: num(process.env.LIST_IDLE_POLL_MS, 120 * 60_000),
    /** İzleyicisi olan canlı maçların detay yoklama aralığı */
    detailPollMs: num(process.env.DETAIL_POLL_MS, 10 * 60_000),
    /** Canlı maçların toplu yoklama aralığı için alt sınır; kalan kotaya göre otomatik uzar */
    livePollMs: num(process.env.LIVE_POLL_MS, 5 * 60_000),
    /** Günlük istek hakkı ve her zaman boşta tutulacak yedek */
    dailyLimit: num(process.env.API_DAILY_LIMIT, 100),
    reserve: num(process.env.API_RESERVE, 5),
  },
  demoTickMs: num(process.env.DEMO_TICK_MS, 4000),
  dbPath: process.env.DB_PATH || './data/safskor.db',
};
