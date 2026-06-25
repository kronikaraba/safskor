import { config } from '../config.js';
import { ApiError } from '../utils/http.js';
import { cacheGet, cacheSet } from './cache.js';

// API-Football (api-sports.io) ücretsiz plan: günde 100 istek + ~10 istek/dk.
// Cache + seri kuyruk ile limitleri koruyoruz.
const RATE_LIMIT = 10;
const WINDOW_MS = 60_000;

// Üyelere ve ziyaretçilere gösterilen yumuşatılmış varsayılan mesajlar.
const PUBLIC_GENERIC = 'Maç verileri şu an alınamıyor, biraz sonra tekrar deneyin.';
const PUBLIC_RATELIMIT = 'Şu an yoğunluk var, birkaç dakika sonra tekrar deneyin.';
const PUBLIC_NOTFOUND = 'Bulunamadı.';

const recent = [];
const inflight = new Map();
let chain = Promise.resolve();

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
    const msg = errorsToMessage(errs);
    if (/limit|requests|reached|token|key/i.test(msg)) {
      throw new ApiError(429, `Futbol API: ${msg}`, PUBLIC_RATELIMIT);
    }
    throw new ApiError(502, `Futbol API: ${msg}`, PUBLIC_GENERIC);
  }

  return data;
}

function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function apiGet(pathAndQuery, { ttlMs = 0 } = {}) {
  const key = pathAndQuery;

  if (ttlMs > 0) {
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
  }
  if (inflight.has(key)) return inflight.get(key);

  const promise = enqueue(() => rawRequest(pathAndQuery))
    .then((data) => {
      if (ttlMs > 0) cacheSet(key, data, ttlMs);
      return data;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}
