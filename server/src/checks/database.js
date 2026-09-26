import { decryptSecret } from "../lib/crypto.js";

// Check database: PostgreSQL, MySQL, Oracle, SQL Server, dan Redis.
//
// Semuanya mengikuti pola yang sama dengan check lain — mengembalikan
// { ok, ms, message } dan tidak pernah melempar. Bedanya, check ini membuka
// koneksi baru tiap kali dan menutupnya lagi: monitor yang memantau kesehatan
// database justru tidak boleh menyimpan koneksi menganggur di sana, dan
// koneksi yang dipakai ulang bisa menyembunyikan justru kegagalan yang
// sedang dicari (pool penuh, autentikasi kedaluwarsa, DNS berubah).
//
// Query bawaannya sengaja paling murah yang masih membuktikan server menjawab.
// Query sendiri boleh diisi lewat check_config.query — berguna untuk memastikan
// sebuah tabel terbaca, bukan sekadar server hidup.

const DEFAULT_QUERY = { postgres: "SELECT 1", mysql: "SELECT 1", oracle: "SELECT 1 FROM DUAL", mssql: "SELECT 1" };

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

// oracle://user:pass@host:1521/SERVICE → kredensial + "host:port/SERVICE".
// Driver dipakai dalam mode thin, jadi tidak butuh Oracle Instant Client.
export function parseOracleUri(uri) {
  const u = new URL(uri);
  if (u.protocol !== "oracle:") throw new Error("Connection string Oracle harus diawali oracle://");
  const service = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!service) throw new Error("Nama service Oracle belum diisi (oracle://user:pass@host:1521/SERVICE)");
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    connectString: `${u.hostname}:${u.port || 1521}/${service}`,
  };
}

// mssql://user:pass@host:1433/db?encrypt=true&trustServerCertificate=true
export function parseMssqlUri(uri) {
  const u = new URL(uri);
  if (u.protocol !== "mssql:") throw new Error("Connection string SQL Server harus diawali mssql://");
  const flag = (name, fallback) => (u.searchParams.has(name) ? u.searchParams.get(name) === "true" : fallback);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    server: u.hostname,
    port: Number(u.port) || 1433,
    database: decodeURIComponent(u.pathname.replace(/^\//, "")) || undefined,
    // Sama seperti Postgres: yang diuji "database menjawab", bukan rantai sertifikatnya
    options: { encrypt: flag("encrypt", true), trustServerCertificate: flag("trustServerCertificate", true) },
  };
}

async function checkOracle(monitor, timeoutSeconds) {
  const { default: oracledb } = await import("oracledb");
  const query = configOf(monitor).query || DEFAULT_QUERY.oracle;
  const conn = await oracledb.getConnection({ ...parseOracleUri(connectionUri(monitor)), connectTimeout: timeoutSeconds });
  try {
    conn.callTimeout = timeoutSeconds * 1000;
    const result = await conn.execute(query);
    return { rows: result.rows?.length ?? 0 };
  } finally {
    await conn.close().catch(() => {});
  }
}

async function checkMssql(monitor, timeoutSeconds) {
  const { default: mssql } = await import("mssql");
  const query = configOf(monitor).query || DEFAULT_QUERY.mssql;
  // ConnectionPool sendiri, bukan mssql.connect() global: pool global dipakai
  // bersama oleh semua monitor SQL Server dan tidak ikut ditutup per check.
  const pool = new mssql.ConnectionPool({
    ...parseMssqlUri(connectionUri(monitor)),
    connectionTimeout: timeoutSeconds * 1000,
    requestTimeout: timeoutSeconds * 1000,
    pool: { max: 1, min: 0 },
  });
  try {
    await pool.connect();
    const result = await pool.request().query(query);
    return { rows: result.recordset?.length ?? 0 };
  } finally {
    await pool.close().catch(() => {});
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

const RUNNERS = { postgres: checkPostgres, mysql: checkMysql, oracle: checkOracle, mssql: checkMssql, redis: checkRedis };

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
