// Basit TTL'li bellek-ici cache. football-data.org ucretsiz katmaninin
// (dakikada 10 istek) limitini korumak icin kritik.
const store = new Map();

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Periyodik temizlik (bellek sismesin diye)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
  }
}, 5 * 60 * 1000).unref?.();
