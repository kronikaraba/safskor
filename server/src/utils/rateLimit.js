// Basit bellek-içi, IP başına kayan pencere rate limiter. Tek Render instance
// (keepalive ile ayakta) için yeterli; brute-force ve spam'i sınırlar.
const buckets = new Map();

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {{ windowMs:number, max:number, name:string, message?:string }} opts
 * name: aynı IP'nin farklı endpoint'lerde ayrı sayılması için.
 */
export function rateLimit({ windowMs, max, name, message }) {
  const msg = message || 'Çok fazla deneme yaptınız. Lütfen biraz sonra tekrar deneyin.';
  return (req, res, next) => {
    const key = `${name}:${clientIp(req)}`;
    const now = Date.now();
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    while (arr.length && arr[0] <= now - windowMs) arr.shift();
    if (arr.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: msg });
    }
    arr.push(now);
    next();
  };
}

// Periyodik temizlik (bellek şişmesin diye)
setInterval(
  () => {
    const now = Date.now();
    for (const [key, arr] of buckets) {
      // 1 saat boyunca dokunulmamış kovaları at
      if (arr.length === 0 || arr[arr.length - 1] <= now - 60 * 60 * 1000) buckets.delete(key);
    }
  },
  10 * 60 * 1000
).unref?.();
