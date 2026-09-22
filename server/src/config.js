import "dotenv/config";
import path from "node:path";

const bool = (v, dflt = false) => (v === undefined ? dflt : /^(1|true|yes|on)$/i.test(String(v)));
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

const isProd = process.env.NODE_ENV === "production";
const jwtSecret = process.env.JWT_SECRET || "";

// Secret bawaan hanya boleh dipakai di luar production — di production server
// menolak start supaya instance tidak jalan dengan token yang bisa ditebak.
const WEAK_SECRETS = ["", "change-me-to-a-long-random-string", "pulsewatch-dev-secret-change-me", "dev-secret-change-me", "secret"];
if (isProd && (WEAK_SECRETS.includes(jwtSecret) || jwtSecret.length < 32)) {
  console.error(
    "[config] JWT_SECRET tidak aman untuk production: isi dengan string acak minimal 32 karakter.\n" +
      "         Contoh: openssl rand -hex 32"
  );
  process.exit(1);
}
if (!isProd && WEAK_SECRETS.includes(jwtSecret)) {
  console.warn("[config] JWT_SECRET masih nilai bawaan — jangan dipakai di production.");
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3001),
  jwtSecret: jwtSecret || "pulsewatch-dev-secret-change-me",
  // Umur token login. Token juga otomatis batal saat password diganti.
  jwtTtl: process.env.JWT_TTL || "7d",
  databaseUrl: process.env.DATABASE_URL,
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  baseUrl: (process.env.BASE_URL || "http://localhost:3001").replace(/\/+$/, ""),
  clientDist: path.resolve(process.env.CLIENT_DIST || "../client/dist"),

  // Di belakang reverse proxy (nginx/traefik): pakai X-Forwarded-For untuk rate limit per IP.
  trustProxy: bool(process.env.TRUST_PROXY, false),
  // Origin yang boleh memanggil API ber-auth. Kosong = hanya BASE_URL (+ origin dev Vite).
  corsOrigins: list(process.env.CORS_ORIGINS),

  // Rate limit login: maksimal percobaan gagal per jendela waktu, lalu dikunci.
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 8),
  loginWindowSeconds: Number(process.env.LOGIN_WINDOW_SECONDS || 300),
  loginLockSeconds: Number(process.env.LOGIN_LOCK_SECONDS || 900),

  // Peringatan sertifikat TLS: kirim notifikasi saat sisa umur <= nilai ini (hari).
  certExpiryWarnDays: Number(process.env.CERT_EXPIRY_WARN_DAYS || 14),
  // Retensi heartbeat (hari) — dibersihkan tiap hari jam 03:00.
  heartbeatRetentionDays: Number(process.env.HEARTBEAT_RETENTION_DAYS || 90),
};

// Origin yang diizinkan untuk API ber-auth & Socket.io.
export function allowedOrigins() {
  const origins = new Set(config.corsOrigins);
  origins.add(config.baseUrl);
  if (!config.isProd) {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
  }
  return [...origins];
}
