import { config } from "../config.js";
import { prisma } from "../db.js";

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

// --- Batas jumlah permintaan per jendela waktu (API key, ack, push) ---
//
// Dua tempat penyimpanan, dipilih lewat RATE_LIMIT_STORE:
// - memory: jendela geser per proses. Murah, cukup untuk satu instance.
// - database: jendela tetap di tabel rate_limits, dihitung dengan jam database
//   supaya semua replika sepakat. Harganya satu upsert per permintaan.
// Limiter login (di atas) tetap in-memory: kuncinya di-reset saat login sukses
// dan jumlah permintaannya kecil.

const windows = new Map(); // key -> number[]

function hitMemory(key, max, windowSeconds) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const arr = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    windows.set(key, arr);
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  windows.set(key, arr);
  return { allowed: true, remaining: max - arr.length, retryAfter: 0 };
}

async function hitDatabase(key, max, windowSeconds) {
  const w = Math.max(1, Math.round(windowSeconds));
  const [row] = await prisma.$queryRaw`
    INSERT INTO rate_limits (key, window_start, expires_at, count)
    VALUES (${key},
            to_timestamp(floor(extract(epoch FROM now()) / ${w}) * ${w}),
            to_timestamp(floor(extract(epoch FROM now()) / ${w}) * ${w} + ${w}),
            1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count, GREATEST(1, ceil(extract(epoch FROM expires_at - now())))::int AS retry_after`;
  const allowed = row.count <= max;
  return { allowed, remaining: Math.max(0, max - row.count), retryAfter: allowed ? 0 : row.retry_after };
}

// Catat satu permintaan untuk `key`. Bila database tidak menjawab, permintaan
// tetap diloloskan: rate limit tidak boleh ikut mematikan API.
export async function hitLimit(key, { max, windowSeconds }) {
  if (config.rateLimitStore !== "database") return hitMemory(key, max, windowSeconds);
  try {
    return await hitDatabase(key, max, windowSeconds);
  } catch (err) {
    console.warn(`[ratelimit] database tidak bisa dipakai, permintaan diloloskan: ${err.message}`);
    return { allowed: true, remaining: max, retryAfter: 0 };
  }
}

// Bersihkan jendela yang sudah lewat, di memori maupun di database
setInterval(() => {
  const now = Date.now();
  for (const [key, arr] of windows) {
    // Jendela terpanjang yang dipakai saat ini 60 detik; 1 jam cukup longgar
    if (arr.every((t) => now - t > 3600_000)) windows.delete(key);
  }
  if (config.rateLimitStore === "database") {
    prisma.$executeRaw`DELETE FROM rate_limits WHERE expires_at < now()`.catch(() => {});
  }
}, 60_000).unref?.();

// Rate limit umum per IP untuk endpoint publik (mis. push & ack).
export function simpleLimiter({ max, windowSeconds, prefix }) {
  return async (req, res, next) => {
    const r = await hitLimit(`${prefix}:${clientIp(req)}`, { max, windowSeconds });
    if (!r.allowed) {
      res.set("Retry-After", String(r.retryAfter || windowSeconds));
      return res.status(429).json({ error: "Terlalu banyak permintaan." });
    }
    next();
  };
}
