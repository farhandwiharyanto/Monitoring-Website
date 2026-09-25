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

  // Ambang peringatan sertifikat TLS (hari). Alert dikirim sekali per ambang
  // yang dilewati, lalu direset saat sertifikat diperbarui.
  certAlertThresholds: list(process.env.CERT_ALERT_THRESHOLDS || "30,14,7,3")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a),
  // Handshake TLS mahal, jadi sertifikat tidak diperiksa tiap interval check.
  certCheckIntervalHours: Number(process.env.CERT_CHECK_INTERVAL_HOURS || 6),
  // Ambang badge "warning" di UI (hari)
  certExpiryWarnDays: Number(process.env.CERT_EXPIRY_WARN_DAYS || 14),

  // --- Multi-location ---
  // Nama lokasi agen ini. Semua heartbeat yang ditulis instance ini diberi label ini.
  locationName: (process.env.LOCATION_NAME || "primary").trim().slice(0, 40),
  // Lokasi yang jadi acuan status, uptime, incident, dan alert. Lokasi lain
  // hanya merekam heartbeat untuk perbandingan.
  primaryLocation: (process.env.PRIMARY_LOCATION || "primary").trim().slice(0, 40),
  // Mode worker: hanya menjalankan scheduler, tanpa API/UI.
  workerOnly: bool(process.env.WORKER_ONLY, false),

  // --- API key ---
  // Rate limit per kunci: batas request per jendela waktu
  apiKeyMaxRequests: Number(process.env.API_KEY_RATE_LIMIT || 60),
  apiKeyWindowSeconds: Number(process.env.API_KEY_RATE_WINDOW_SECONDS || 60),

  // --- Webhook automation ---
  // Percobaan pemanggilan webhook aksi (termasuk percobaan pertama)
  actionWebhookAttempts: Number(process.env.ACTION_WEBHOOK_ATTEMPTS || 3),
  actionWebhookTimeoutSeconds: Number(process.env.ACTION_WEBHOOK_TIMEOUT_SECONDS || 15),

  // --- Prometheus ---
  // Token scrape untuk /metrics. Kosong + METRICS_PUBLIC=false → hanya JWT yang diterima.
  metricsToken: process.env.METRICS_TOKEN || "",
  metricsPublic: bool(process.env.METRICS_PUBLIC, false),

  // Kunci enkripsi kredensial monitor (auth header). Bila kosong, diturunkan
  // dari JWT_SECRET — mengganti JWT_SECRET berarti kredensial lama tidak terbaca.
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  // Retensi heartbeat (hari) — dibersihkan tiap hari jam 03:00.
  heartbeatRetentionDays: Number(process.env.HEARTBEAT_RETENTION_DAYS || 90),
  // --- Laporan SLA ---
  // Downtime saat maintenance window aktif tidak dihitung melanggar SLA.
  // Set false bila ingin laporan memakai waktu kalender apa adanya.
  slaExcludeMaintenance: bool(process.env.SLA_EXCLUDE_MAINTENANCE, true),
  // Target SLO bawaan untuk monitor baru (persen). Kosong = tanpa target.
  sloDefaultTarget: process.env.SLO_DEFAULT_TARGET ? Number(process.env.SLO_DEFAULT_TARGET) : null,

  // --- Lease scheduler & shutdown ---
  // Berapa lama lease kepemimpinan berlaku sejak terakhir diperbarui. Proses
  // lain baru boleh mengambil alih setelah selang ini terlewat tanpa perpanjangan.
  schedulerLeaseSeconds: Number(process.env.SCHEDULER_LEASE_SECONDS || 30),
  // Jarak antar perpanjangan. Harus jauh lebih kecil dari masa berlaku supaya
  // gangguan sesaat tidak langsung melepas kepemimpinan.
  schedulerLeaseRenewSeconds: Number(process.env.SCHEDULER_LEASE_RENEW_SECONDS || 10),
  // Batas waktu berhenti dengan rapi sebelum proses dipaksa keluar (detik).
  shutdownTimeoutSeconds: Number(process.env.SHUTDOWN_TIMEOUT_SECONDS || 15),

  // Retensi audit log (hari). Lebih panjang dari heartbeat karena yang disimpan
  // adalah jejak perubahan konfigurasi, bukan data deret waktu.
  auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS || 365),
};

// Instance ini yang memegang keputusan status/incident/alert?
export const isPrimaryLocation = () => config.locationName === config.primaryLocation;

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
