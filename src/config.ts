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
    listPollMs: num(process.env.LIST_POLL_MS, 60_000),
    detailPollMs: num(process.env.DETAIL_POLL_MS, 30_000),
  },
  demoTickMs: num(process.env.DEMO_TICK_MS, 4000),
  dbPath: process.env.DB_PATH || './data/safskor.db',
};
