import { config } from "../config.js";

// Rate limiter in-memory (cukup untuk deployment single-instance Pulsewatch).
// Menghitung percobaan GAGAL per kunci; login sukses me-reset penghitungnya.
const buckets = new Map(); // key -> { hits: number[], lockedUntil: number }

// Bersihkan entri kedaluwarsa agar Map tidak tumbuh terus
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.lockedUntil > now) continue;
    b.hits = b.hits.filter((t) => now - t < config.loginWindowSeconds * 1000);
    if (b.hits.length === 0) buckets.delete(key);
  }
}, 60_000).unref?.();

export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Sisa waktu kunci (detik); 0 berarti tidak terkunci.
export function lockRemaining(key) {
  const b = buckets.get(key);
  if (!b || b.lockedUntil <= Date.now()) return 0;
  return Math.ceil((b.lockedUntil - Date.now()) / 1000);
}

export function recordFailure(key) {
  const now = Date.now();
  const b = buckets.get(key) || { hits: [], lockedUntil: 0 };
  b.hits = b.hits.filter((t) => now - t < config.loginWindowSeconds * 1000);
  b.hits.push(now);
  if (b.hits.length >= config.loginMaxAttempts) {
    b.lockedUntil = now + config.loginLockSeconds * 1000;
    b.hits = [];
  }
  buckets.set(key, b);
  return b.lockedUntil > now ? Math.ceil((b.lockedUntil - now) / 1000) : 0;
}

export function resetKey(key) {
  buckets.delete(key);
}

// Middleware: tolak lebih dulu kalau kunci sedang terkunci.
// `keys(req)` mengembalikan daftar kunci yang dicek (mis. per-IP dan per-username).
export function blockWhenLocked(keys) {
  return (req, res, next) => {
    for (const key of keys(req)) {
      const wait = lockRemaining(key);
      if (wait) {
        res.set("Retry-After", String(wait));
        return res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.` });
      }
    }
    next();
  };
}

// Rate limit umum per IP untuk endpoint publik (mis. push & status page).
export function simpleLimiter({ max, windowSeconds, prefix }) {
  const hits = new Map(); // key -> number[]
  return (req, res, next) => {
    const now = Date.now();
    const key = `${prefix}:${clientIp(req)}`;
    const arr = (hits.get(key) || []).filter((t) => now - t < windowSeconds * 1000);
    if (arr.length >= max) {
      res.set("Retry-After", String(windowSeconds));
      return res.status(429).json({ error: "Terlalu banyak permintaan." });
    }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowSeconds * 1000)) hits.delete(k);
    next();
  };
}
