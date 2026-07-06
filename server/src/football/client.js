import { config } from '../config.js';
import { ApiError } from '../utils/http.js';
import { cacheGetEntry, cacheSet } from './cache.js';
import { isFootballApiSuspended } from '../store/settings.js';

// API-Football (api-sports.io) ücretsiz plan: günde 100 istek + ~10 istek/dk.
// Agresif cache + stale-while-revalidate ile bu limitleri korur, yüklemeyi
// <1 sn tutarız: istemciye anında (bayat olsa da) cache'ten veririz, gerekirse
// arka planda tek bir upstream isteğiyle yenileriz. Dakikalık throttle yalnızca
// 10 istek/dk sınırına saygı için.
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

// Üyelere ve ziyaretçilere gösterilen yumuşatılmış varsayılan mesajlar.
const PUBLIC_GENERIC = 'Maç verileri şu an alınamıyor, biraz sonra tekrar deneyin.';
const PUBLIC_RATELIMIT = 'Şu an yoğunluk var, birkaç dakika sonra tekrar deneyin.';
const PUBLIC_NOTFOUND = 'Bulunamadı.';

const recent = [];
const inflight = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
  const now = Date.now();
  while (recent.length && recent[0] <= now - WINDOW_MS) recent.shift();
  if (recent.length >= RATE_LIMIT) {
    await sleep(recent[0] + WINDOW_MS - now + 50);
    return throttle();
  }
  recent.push(Date.now());
}

function errorsToMessage(errs) {
  if (!errs) return '';
  if (Array.isArray(errs)) return errs.join(' ');
  if (typeof errs === 'object') return Object.values(errs).join(' ');
  return String(errs);
}

async function rawRequest(pathAndQuery) {
  // Admin kill-switch: askıdayken upstream'e hiç çıkılmaz (kota harcanmaz).
  // Taze/bayat cache apiGet katmanında yine servis edilir; maç listesi de
  // manuel maçlarla "apiDegraded" modunda çalışmaya devam eder.
  if (await isFootballApiSuspended()) {
    throw new ApiError(503, 'Futbol API yönetici tarafından askıya alındı.', PUBLIC_GENERIC);
  }
  if (!config.football.apiKey) {
    throw new ApiError(
      503,
      'API-Football anahtarı yapılandırılmamış. server/.env içine API_FOOTBALL_KEY ekleyin.',
      PUBLIC_GENERIC
    );
  }
  await throttle();

  const url = `${config.football.baseUrl}${pathAndQuery}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'x-apisports-key': config.football.apiKey } });
  } catch {
    throw new ApiError(502, 'Futbol API sunucusuna ulaşılamadı.', PUBLIC_GENERIC);
  }

  if (res.status === 429) {
    throw new ApiError(
      429,
      'Futbol API istek limiti aşıldı, biraz sonra tekrar deneyin.',
      PUBLIC_RATELIMIT
    );
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(502, 'Futbol API yanıtı okunamadı.', PUBLIC_GENERIC);
  }

  if (!res.ok) {
    const is404 = res.status === 404;
    throw new ApiError(
      is404 ? 404 : 502,
      `Futbol API hatası (${res.status}).`,
      is404 ? PUBLIC_NOTFOUND : PUBLIC_GENERIC
    );
  }

  // API-Football 200 döndürüp hatayı "errors" alanında verebilir.
  const errs = data?.errors;
  const hasErr = Array.isArray(errs)
    ? errs.length > 0
    : errs && typeof errs === 'object' && Object.keys(errs).length > 0;
  if (hasErr) {
    // Plan kısıtlaması (örn. ücretsiz planda erişilemeyen tarih) → hata değil:
    // boş sonucu (response: []) olduğu gibi döndür, üst katman "maç yok" gösterir.
    if (!Array.isArray(errs) && typeof errs === 'object' && errs.plan) {
      return data;
    }
    const msg = errorsToMessage(errs);
    if (/limit|requests|reached|token|key/i.test(msg)) {
      throw new ApiError(429, `Futbol API: ${msg}`, PUBLIC_RATELIMIT);
    }
    throw new ApiError(502, `Futbol API: ${msg}`, PUBLIC_GENERIC);
  }

  return data;
}

// Aynı anahtar için tek upstream isteği (dedupe) + cache yaz.
function fetchAndCache(key, pathAndQuery, ttlMs) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = rawRequest(pathAndQuery)
    .then((data) => {
      if (ttlMs > 0) cacheSet(key, data, ttlMs);
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

// Stale-while-revalidate:
//  - Taze cache → anında döndür.
//  - Bayat cache → anında bayatı döndür, arka planda yenile.
//  - Cache yok → upstream'i bekle (yalnızca ilk yükleme).
export async function apiGet(pathAndQuery, { ttlMs = 0 } = {}) {
  const key = pathAndQuery;
  if (ttlMs <= 0) return fetchAndCache(key, pathAndQuery, 0);

  const entry = cacheGetEntry(key);
  if (entry) {
    if (entry.expires > Date.now()) return entry.value; // taze
    if (!inflight.has(key)) fetchAndCache(key, pathAndQuery, ttlMs).catch(() => {}); // arka plan
    return entry.value; // bayatı hemen ver
  }
  return fetchAndCache(key, pathAndQuery, ttlMs);
}
