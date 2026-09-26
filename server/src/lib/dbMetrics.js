// Metrik database untuk menu Database: satu bentuk yang sama untuk PostgreSQL,
// MySQL, Oracle, dan SQL Server.
//
// Tiap metrik dibaca dengan query-nya sendiri, dan query yang gagal (izin
// kurang, view tidak ada di edisi tertentu, server bukan replica) hanya
// membuat metrik itu null — tidak pernah menggagalkan check. Monitor yang
// hidup tidak boleh jadi down hanya karena user monitoring kurang satu izin.
//
// Penghitung kumulatif (queries_total, deadlocks_total) disimpan mentah; laju
// per detiknya dihitung saat dibaca dari selisih dua sampel berurutan.

export const METRIC_TYPES = ["postgres", "mysql", "oracle", "mssql"];
// Paling sering sekali per 5 menit per monitor, bukan tiap check, supaya
// database yang dipantau tidak ikut terbebani oleh pemantauannya.
export const METRIC_INTERVAL_MS = 5 * 60_000;

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const ratio = (hit, miss) => {
  const h = num(hit), m = num(miss);
  if (h === null || m === null || h + m <= 0) return null;
  return Math.round((h / (h + m)) * 10000) / 100;
};
const first = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null);
// Baris bentuk { name, value } (SHOW STATUS, v$sysstat, performance counter) → objek
const pairs = (rows, nameKey = "name", valueKey = "value") =>
  Object.fromEntries((rows || []).map((r) => [String(r[nameKey]).trim().toLowerCase(), r[valueKey]]));

const DIALECTS = {
  postgres: {
    queries: {
      conn: "SELECT (SELECT count(*) FROM pg_stat_activity)::int AS used, current_setting('max_connections')::int AS max",
      size: "SELECT pg_database_size(current_database())::bigint AS size",
      stat: `SELECT sum(blks_hit)::bigint AS hit, sum(blks_read)::bigint AS read,
               sum(xact_commit + xact_rollback)::bigint AS queries, sum(deadlocks)::bigint AS deadlocks
             FROM pg_stat_database`,
      long: "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '30 seconds'",
      locks: "SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted",
      repl: "SELECT CASE WHEN pg_is_in_recovery() THEN extract(epoch FROM now() - pg_last_xact_replay_timestamp()) END AS lag",
      info: "SELECT version() AS version, pg_postmaster_start_time() AS started",
    },
    normalize(r) {
      const conn = first(r.conn), stat = first(r.stat), info = first(r.info);
      return {
        conn_used: num(conn?.used),
        conn_max: num(conn?.max),
        size_bytes: num(first(r.size)?.size),
        cache_hit: ratio(stat?.hit, stat?.read),
        queries_total: num(stat?.queries),
        deadlocks_total: num(stat?.deadlocks),
        long_queries: num(first(r.long)?.n),
        lock_waits: num(first(r.locks)?.n),
        repl_lag_s: num(first(r.repl)?.lag),
        version: info?.version ? String(info.version).split(" on ")[0] : null,
        started_at: iso(info?.started),
      };
    },
  },

  mysql: {
    queries: {
      status: `SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Questions', 'Uptime',
               'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads', 'Innodb_row_lock_current_waits')`,
      vars: "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('max_connections', 'version')",
      // Tanpa database terpilih ukurannya tidak berarti (null); database kosong = 0
      size: "SELECT IF(DATABASE() IS NULL, NULL, COALESCE(SUM(data_length + index_length), 0)) AS size FROM information_schema.tables WHERE table_schema = DATABASE()",
      long: `SELECT COUNT(*) AS n FROM information_schema.processlist
             WHERE command NOT IN ('Sleep', 'Daemon', 'Binlog Dump', 'Binlog Dump GTID') AND time > 30`,
      repl: "SHOW REPLICA STATUS",
    },
    normalize(r, now = Date.now()) {
      const s = pairs(r.status, "Variable_name", "Value");
      const v = pairs(r.vars, "Variable_name", "Value");
      const requests = num(s.innodb_buffer_pool_read_requests), reads = num(s.innodb_buffer_pool_reads);
      const uptime = num(s.uptime);
      return {
        conn_used: num(s.threads_connected),
        conn_max: num(v.max_connections),
        size_bytes: num(first(r.size)?.size),
        // read_requests adalah semua baca logis, reads yang terpaksa ke disk
        cache_hit: requests === null || reads === null ? null : ratio(requests - reads, reads),
        queries_total: num(s.questions),
        deadlocks_total: null,
        long_queries: num(first(r.long)?.n),
        lock_waits: num(s.innodb_row_lock_current_waits),
        repl_lag_s: num(first(r.repl)?.Seconds_Behind_Source),
        version: v.version ? String(v.version) : null,
        started_at: uptime === null ? null : new Date(now - uptime * 1000).toISOString(),
      };
    },
  },

  oracle: {
    queries: {
      conn: `SELECT (SELECT COUNT(*) FROM v$session) AS used,
               (SELECT TO_NUMBER(value) FROM v$parameter WHERE name = 'sessions') AS max FROM dual`,
      size: "SELECT SUM(bytes) AS sz FROM dba_data_files",
      stat: `SELECT name, value FROM v$sysstat
             WHERE name IN ('session logical reads', 'physical reads', 'user calls', 'enqueue deadlocks')`,
      long: "SELECT COUNT(*) AS n FROM v$session WHERE status = 'ACTIVE' AND type = 'USER' AND last_call_et > 30",
      locks: "SELECT COUNT(*) AS n FROM v$session WHERE blocking_session IS NOT NULL",
      repl: "SELECT value FROM v$dataguard_stats WHERE name = 'apply lag'",
      // startup_time bertipe DATE tanpa zona dan driver membacanya sebagai waktu
      // lokal proses Node; selisih yang dihitung di server database bebas dari itu.
      info: "SELECT version, ROUND((SYSDATE - startup_time) * 86400) AS uptime_s FROM v$instance",
    },
    normalize(r, now = Date.now()) {
      const conn = first(r.conn), info = first(r.info);
      const s = pairs(r.stat);
      const uptime = num(info?.uptime_s);
      const logical = num(s["session logical reads"]), physical = num(s["physical reads"]);
      return {
        conn_used: num(conn?.used),
        conn_max: num(conn?.max),
        size_bytes: num(first(r.size)?.sz),
        cache_hit: logical === null || physical === null ? null : ratio(logical - physical, physical),
        queries_total: num(s["user calls"]),
        deadlocks_total: num(s["enqueue deadlocks"]),
        long_queries: num(first(r.long)?.n),
        lock_waits: num(first(r.locks)?.n),
        repl_lag_s: parseOracleInterval(first(r.repl)?.value),
        version: info?.version ? String(info.version) : null,
        started_at: uptime === null ? null : new Date(now - uptime * 1000).toISOString(),
      };
    },
  },

  mssql: {
    queries: {
      conn: "SELECT (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS used, @@MAX_CONNECTIONS AS max",
      size: "SELECT SUM(CAST(size AS bigint)) * 8192 AS size FROM sys.master_files WHERE database_id = DB_ID()",
      // Nilai "…/sec" di view ini sebenarnya penghitung kumulatif
      stat: `SELECT RTRIM(counter_name) AS name, cntr_value AS value FROM sys.dm_os_performance_counters
             WHERE counter_name IN ('Buffer cache hit ratio', 'Buffer cache hit ratio base', 'Batch Requests/sec')
                OR (counter_name = 'Number of Deadlocks/sec' AND instance_name = '_Total')`,
      long: "SELECT COUNT(*) AS n FROM sys.dm_exec_requests WHERE session_id <> @@SPID AND session_id > 50 AND total_elapsed_time > 30000",
      locks: "SELECT COUNT(*) AS n FROM sys.dm_exec_requests WHERE blocking_session_id <> 0",
      info: "SELECT @@VERSION AS version, sqlserver_start_time AS started FROM sys.dm_os_sys_info",
    },
    normalize(r) {
      const conn = first(r.conn), info = first(r.info);
      const s = pairs(r.stat);
      const hit = num(s["buffer cache hit ratio"]), base = num(s["buffer cache hit ratio base"]);
      return {
        conn_used: num(conn?.used),
        conn_max: num(conn?.max),
        size_bytes: num(first(r.size)?.size),
        cache_hit: hit === null || !base ? null : Math.round((hit / base) * 10000) / 100,
        queries_total: num(s["batch requests/sec"]),
        deadlocks_total: num(s["number of deadlocks/sec"]),
        long_queries: num(first(r.long)?.n),
        lock_waits: num(first(r.locks)?.n),
        repl_lag_s: null,
        version: info?.version ? String(info.version).split("\n")[0].trim() : null,
        started_at: iso(info?.started),
      };
    },
  },
};

// "+00 00:00:05" (INTERVAL DAY TO SECOND dari Data Guard) → detik
export function parseOracleInterval(value) {
  const m = /^\+?(\d+) (\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(value ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Math.round(Number(m[4]));
}

export function normalizeMetrics(type, raw, now) {
  return DIALECTS[type].normalize(raw, now);
}

// exec(sql) → array baris. Query dijalankan berurutan di koneksi yang sama;
// yang gagal dicatat null, lainnya tetap dibaca.
export async function collectMetrics(type, exec) {
  const dialect = DIALECTS[type];
  if (!dialect) return null;
  const raw = {};
  for (const [key, sql] of Object.entries(dialect.queries)) {
    try {
      raw[key] = await exec(sql);
    } catch {
      raw[key] = null;
    }
  }
  return dialect.normalize(raw);
}

// Deret waktu dari sampel yang terurut naik. Laju per detik dihitung dari
// selisih dengan sampel sebelumnya; kalau penghitungnya turun (server
// restart), lajunya null, bukan angka negatif atau lonjakan palsu.
export function toSeries(samples) {
  const out = [];
  let prev = null;
  for (const s of samples) {
    const m = s.metrics || {};
    const t = new Date(s.created_at).getTime();
    const rate = (key) => {
      if (!prev) return null;
      const a = num(prev.m[key]), b = num(m[key]);
      const dt = (t - prev.t) / 1000;
      if (a === null || b === null || b < a || dt <= 0) return null;
      return Math.round(((b - a) / dt) * 100) / 100;
    };
    out.push({
      t: new Date(t).toISOString(),
      conn_used: num(m.conn_used),
      conn_pct: m.conn_used != null && m.conn_max ? Math.round((m.conn_used / m.conn_max) * 1000) / 10 : null,
      cache_hit: num(m.cache_hit),
      size_bytes: num(m.size_bytes),
      qps: rate("queries_total"),
      deadlocks_per_s: rate("deadlocks_total"),
      long_queries: num(m.long_queries),
      lock_waits: num(m.lock_waits),
      repl_lag_s: num(m.repl_lag_s),
    });
    prev = { m, t };
  }
  return out;
}

// Grafik tidak butuh lebih dari ~600 titik; 30 hari × 5 menit = 8.640 sampel
export function downsample(series, max = 600) {
  if (series.length <= max) return series;
  const step = Math.ceil(series.length / max);
  return series.filter((_, i) => i % step === 0 || i === series.length - 1);
}

// Ambang temuan otomatis. Sengaja konstanta, bukan pengaturan: angka ini
// titik awal yang masuk akal, dan menu Database hanya memberi tahu, tidak
// mengirim alert.
export const FINDING_THRESHOLDS = {
  conn_pct: 80, // koneksi terpakai > 80% dari maksimum
  cache_hit: 90, // cache hit < 90%
  long_queries: 0, // ada query berjalan > 30 detik
  lock_waits: 0, // ada lock yang menunggu
  repl_lag_s: 60, // replication lag > 60 detik
  size_growth_pct: 20, // ukuran naik > 20% dalam 7 hari
};

// metrics: sampel terbaru; weekAgo: sampel tertua dalam 7 hari terakhir
export function findings(metrics, weekAgo) {
  if (!metrics) return [];
  const T = FINDING_THRESHOLDS;
  const out = [];
  const connPct = metrics.conn_used != null && metrics.conn_max ? (metrics.conn_used / metrics.conn_max) * 100 : null;
  if (connPct !== null && connPct > T.conn_pct) out.push({ key: "conn_pct", value: Math.round(connPct * 10) / 10, threshold: T.conn_pct });
  if (metrics.cache_hit != null && metrics.cache_hit < T.cache_hit) out.push({ key: "cache_hit", value: metrics.cache_hit, threshold: T.cache_hit });
  if (metrics.long_queries > T.long_queries) out.push({ key: "long_queries", value: metrics.long_queries, threshold: 30 });
  if (metrics.lock_waits > T.lock_waits) out.push({ key: "lock_waits", value: metrics.lock_waits, threshold: T.lock_waits });
  if (metrics.repl_lag_s != null && metrics.repl_lag_s > T.repl_lag_s) out.push({ key: "repl_lag_s", value: metrics.repl_lag_s, threshold: T.repl_lag_s });
  const before = num(weekAgo?.size_bytes), now = num(metrics.size_bytes);
  if (before > 0 && now !== null) {
    const growth = ((now - before) / before) * 100;
    if (growth > T.size_growth_pct) out.push({ key: "size_growth_pct", value: Math.round(growth * 10) / 10, threshold: T.size_growth_pct });
  }
  return out;
}
