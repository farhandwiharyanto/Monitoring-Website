import { decryptSecret } from "../lib/crypto.js";

// Check database: PostgreSQL, MySQL, dan Redis.
//
// Ketiganya mengikuti pola yang sama dengan check lain — mengembalikan
// { ok, ms, message } dan tidak pernah melempar. Bedanya, check ini membuka
// koneksi baru tiap kali dan menutupnya lagi: monitor yang memantau kesehatan
// database justru tidak boleh menyimpan koneksi menganggur di sana, dan
// koneksi yang dipakai ulang bisa menyembunyikan justru kegagalan yang
// sedang dicari (pool penuh, autentikasi kedaluwarsa, DNS berubah).
//
// Query bawaannya sengaja paling murah yang masih membuktikan server menjawab.
// Query sendiri boleh diisi lewat check_config.query — berguna untuk memastikan
// sebuah tabel terbaca, bukan sekadar server hidup.

const DEFAULT_QUERY = { postgres: "SELECT 1", mysql: "SELECT 1" };

// Pesan driver kadang memuat connection string lengkap beserta passwordnya.
// Apa pun yang berbentuk ://user:password@ disamarkan sebelum jadi pesan
// heartbeat, karena heartbeat terbaca oleh viewer dan ikut ke export.
export function sanitize(message) {
  return String(message || "")
    .replace(/\/\/([^:/@\s]+):([^@\s]+)@/g, "//$1:***@")
    .slice(0, 300);
}

const now = () => performance.now();
const elapsed = (start) => Math.round(now() - start);

// Batas waktu yang dipegang sendiri: sebagian driver mengabaikan timeout-nya
// saat macet pada tahap TCP, jadi janjinya dilombakan dengan timer.
function withTimeout(promise, seconds, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout setelah ${seconds}s`)), seconds * 1000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function connectionUri(monitor) {
  const uri = decryptSecret(monitor.conn_secret);
  if (!uri) throw new Error("Connection string belum diisi atau tidak bisa dibuka");
  return uri;
}

const configOf = (monitor) => (monitor.check_config && typeof monitor.check_config === "object" ? monitor.check_config : {});

async function checkPostgres(monitor, timeoutSeconds) {
  const { default: pg } = await import("pg");
  const query = configOf(monitor).query || DEFAULT_QUERY.postgres;
  const client = new pg.Client({
    connectionString: connectionUri(monitor),
    connectionTimeoutMillis: timeoutSeconds * 1000,
    query_timeout: timeoutSeconds * 1000,
    // Monitor tidak boleh gagal hanya karena sertifikat internal tidak dikenal;
    // yang diuji adalah "database ini menjawab", bukan rantai sertifikatnya.
    ssl: /[?&]sslmode=(require|prefer)/.test(connectionUri(monitor)) ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    const result = await client.query(query);
    return { rows: result.rowCount ?? result.rows?.length ?? 0 };
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkMysql(monitor, timeoutSeconds) {
  const mysql = await import("mysql2/promise");
  const query = configOf(monitor).query || DEFAULT_QUERY.mysql;
  const conn = await mysql.createConnection({
    uri: connectionUri(monitor),
    connectTimeout: timeoutSeconds * 1000,
  });
  try {
    const [rows] = await conn.query(query);
    return { rows: Array.isArray(rows) ? rows.length : 0 };
  } finally {
    await conn.end().catch(() => {});
  }
}

async function checkRedis(monitor, timeoutSeconds) {
  const { createClient } = await import("redis");
  const client = createClient({
    url: connectionUri(monitor),
    socket: { connectTimeout: timeoutSeconds * 1000, reconnectStrategy: false },
  });
  // Tanpa listener "error", kegagalan koneksi jadi unhandled error yang
  // menjatuhkan seluruh proses, bukan sekadar menggagalkan satu check.
  client.on("error", () => {});
  try {
    await client.connect();
    const pong = await client.ping();
    return { rows: 0, detail: String(pong) };
  } finally {
    // destroy() melempar ClientClosedError bila koneksinya memang tidak pernah
    // terbuka. Kalau dibiarkan, error dari finally menggantikan penyebab asli
    // dan pesan heartbeat-nya jadi "The client is closed" — tidak memberi tahu
    // apa pun tentang apa yang sebenarnya salah.
    try {
      await client.destroy?.();
    } catch {
      /* koneksi memang belum pernah terbuka */
    }
  }
}

const RUNNERS = { postgres: checkPostgres, mysql: checkMysql, redis: checkRedis };

export async function checkDatabase(monitor) {
  const runner = RUNNERS[monitor.type];
  if (!runner) return { ok: false, ms: 0, message: `Tipe database tidak dikenal: ${monitor.type}` };

  const timeoutSeconds = Math.min(Math.max(Number(monitor.timeout_seconds) || 10, 1), 120);
  const start = now();
  try {
    const result = await withTimeout(runner(monitor, timeoutSeconds), timeoutSeconds, monitor.type);
    const ms = elapsed(start);
    const detail = result.detail ? ` · ${result.detail}` : result.rows ? ` · ${result.rows} baris` : "";
    return { ok: true, ms, message: `${monitor.type} OK${detail}` };
  } catch (err) {
    return { ok: false, ms: elapsed(start), message: sanitize(err.message) };
  }
}
