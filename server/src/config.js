import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env'i calisma dizininden bagimsiz olarak daima server/ kokunden yukle.
// override: true => .env, kabuktan miras alinan PORT vb. degerleri ezer
// (Vite/dev harness PORT=5173 set edebiliyor; backend bunu kullanmamalı.)
dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

function parseList(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseOrigins(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

const clientOrigins = parseOrigins(process.env.CLIENT_ORIGIN || 'http://localhost:5173');

export const config = {
  port: Number(process.env.PORT) || 4000,
  isProd: process.env.NODE_ENV === 'production',
  clientOrigin: clientOrigins[0],
  clientOrigins,

  jwtSecret: process.env.JWT_SECRET || 'safskor-dev-insecure-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  databaseUrl: process.env.DATABASE_URL || '',

  adminEmails: parseList(process.env.ADMIN_EMAILS),

  football: {
    apiKey: process.env.API_FOOTBALL_KEY || '',
    baseUrl: (process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io').replace(/\/$/, ''),
  },
};

export function assertConfig() {
  if (config.jwtSecret.includes('change-me') && config.isProd) {
    // eslint-disable-next-line no-console
    console.warn('[config] UYARI: Uretimde JWT_SECRET degistirilmeli.');
  }
  if (!config.football.apiKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] UYARI: API_FOOTBALL_KEY tanimli degil. Mac/skor/dizilis verisi cekilemez. ' +
        'server/.env dosyasina anahtarinizi ekleyin (https://dashboard.api-football.com/register).'
    );
  }
  if (!config.databaseUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] UYARI: DATABASE_URL tanımlı değil. Neon Postgres connection string ekleyin.'
    );
  }
}
