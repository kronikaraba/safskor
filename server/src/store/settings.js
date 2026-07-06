import { sql } from '../db.js';

// Uygulama geneli anahtar/değer ayarları (app_settings tablosu). Sık okunan
// bayraklar için kısa süreli bellek cache'i tutulur ki her upstream isteğinde
// DB'ye gidilmesin; aynı süreçte set edilince cache anında güncellenir.
const CACHE_MS = 10_000;
const cache = new Map(); // key -> { value, expires }

export async function getSetting(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [row] = await sql`SELECT value FROM app_settings WHERE key = ${key}`;
  const value = row?.value ?? null;
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  return value;
}

export async function setSetting(key, value) {
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
}

// --- Futbol API kill-switch (admin panelinden askıya alma) ---

const FOOTBALL_API_SUSPENDED = 'football_api_suspended';

export async function isFootballApiSuspended() {
  return (await getSetting(FOOTBALL_API_SUSPENDED)) === '1';
}

export async function setFootballApiSuspended(suspended) {
  await setSetting(FOOTBALL_API_SUSPENDED, suspended ? '1' : '0');
}
