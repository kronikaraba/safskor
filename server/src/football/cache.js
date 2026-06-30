// Basit TTL'li bellek-ici cache + stale-while-revalidate destegi.
// Suresi gecmis ("bayat") kayitlar bir sure saklanir: istemciye aninda bayat
// veri donulur, arka planda yenilenir. Boylece yukleme <1 sn olur ve az sayida
// upstream istegiyle aylik kota korunur.
const store = new Map();

// Bayat veriyi bu sure kadar tut (SWR icin). Quota bittiginde bile site son
// bilinen veriyle calismaya devam eder.
const STALE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Sadece TAZE deger (suresi gecmediyse). Geriye uyumluluk icin korunur. */
export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now()) return undefined;
  return entry.value;
}

/** Kaydin tamami ({ value, expires }) — suresi gecmis olsa bile (SWR icin). */
export function cacheGetEntry(key) {
  return store.get(key);
}

export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

// Periyodik temizlik: yalnizca cok eski (suresi + grace gecmis) kayitlari sil.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expires + STALE_GRACE_MS <= now) store.delete(key);
  }
}, 30 * 60 * 1000).unref?.();
