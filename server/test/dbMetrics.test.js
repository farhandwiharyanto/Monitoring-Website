import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMetrics, collectMetrics, toSeries, downsample, parseOracleInterval } from "../src/lib/dbMetrics.js";

const KEYS = ["conn_used", "conn_max", "size_bytes", "cache_hit", "queries_total", "deadlocks_total",
  "long_queries", "lock_waits", "repl_lag_s", "version", "started_at"];

test("PostgreSQL: bigint berupa string diubah jadi angka, cache hit dari blks_hit/read", () => {
  const m = normalizeMetrics("postgres", {
    conn: [{ used: 12, max: 100 }],
    size: [{ size: "8388608" }],
    stat: [{ hit: "990", read: "10", queries: "5000", deadlocks: "2" }],
    long: [{ n: 1 }],
    locks: [{ n: 0 }],
    repl: [{ lag: null }],
    info: [{ version: "PostgreSQL 16.4 on aarch64-unknown-linux-musl, compiled by gcc", started: new Date("2026-09-01T00:00:00Z") }],
  });
  assert.deepEqual(Object.keys(m), KEYS);
  assert.equal(m.size_bytes, 8388608);
  assert.equal(m.cache_hit, 99);
  assert.equal(m.queries_total, 5000);
  assert.equal(m.repl_lag_s, null);
  assert.equal(m.version, "PostgreSQL 16.4");
  assert.equal(m.started_at, "2026-09-01T00:00:00.000Z");
});

test("MySQL: SHOW STATUS dibaca per nama, uptime jadi waktu start", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const m = normalizeMetrics("mysql", {
    status: [
      { Variable_name: "Threads_connected", Value: "7" },
      { Variable_name: "Questions", Value: "12345" },
      { Variable_name: "Uptime", Value: "3600" },
      { Variable_name: "Innodb_buffer_pool_read_requests", Value: "1000" },
      { Variable_name: "Innodb_buffer_pool_reads", Value: "50" },
      { Variable_name: "Innodb_row_lock_current_waits", Value: "2" },
    ],
    vars: [{ Variable_name: "max_connections", Value: "151" }, { Variable_name: "version", Value: "8.0.39" }],
    size: [{ size: "1048576" }],
    long: [{ n: 0 }],
    repl: [],
  }, now);
  assert.equal(m.conn_used, 7);
  assert.equal(m.conn_max, 151);
  assert.equal(m.cache_hit, 95);
  assert.equal(m.lock_waits, 2);
  assert.equal(m.repl_lag_s, null);
  assert.equal(m.started_at, "2026-09-27T11:00:00.000Z");
});

test("Oracle: v$sysstat dan apply lag Data Guard", () => {
  const m = normalizeMetrics("oracle", {
    conn: [{ used: 40, max: 472 }],
    size: [{ sz: 2147483648 }],
    stat: [
      { name: "session logical reads", value: 10000 },
      { name: "physical reads", value: 200 },
      { name: "user calls", value: 777 },
      { name: "enqueue deadlocks", value: 0 },
    ],
    long: [{ n: 0 }],
    locks: [{ n: 3 }],
    repl: [{ value: "+00 00:01:05" }],
    info: [{ version: "23.0.0.0.0", uptime_s: 86400 }],
  }, Date.parse("2026-09-21T00:00:00Z"));
  assert.equal(m.started_at, "2026-09-20T00:00:00.000Z");
  assert.equal(m.cache_hit, 98);
  assert.equal(m.queries_total, 777);
  assert.equal(m.lock_waits, 3);
  assert.equal(m.repl_lag_s, 65);
  assert.equal(parseOracleInterval("+01 02:00:00"), 93600);
  assert.equal(parseOracleInterval(null), null);
});

test("SQL Server: cache hit dari counter dan basisnya, nama counter berspasi", () => {
  const m = normalizeMetrics("mssql", {
    conn: [{ used: 5, max: 32767 }],
    size: [{ size: 16777216 }],
    stat: [
      { name: "Buffer cache hit ratio", value: 450 },
      { name: "Buffer cache hit ratio base", value: 500 },
      { name: "Batch Requests/sec  ", value: 9000 },
      { name: "Number of Deadlocks/sec", value: 1 },
    ],
    long: [{ n: 2 }],
    locks: [{ n: 0 }],
    info: [{ version: "Microsoft SQL Server 2022 (RTM-CU14)\n\tCopyright", started: "2026-09-27T01:00:00Z" }],
  });
  assert.equal(m.cache_hit, 90);
  assert.equal(m.queries_total, 9000);
  assert.equal(m.deadlocks_total, 1);
  assert.equal(m.version, "Microsoft SQL Server 2022 (RTM-CU14)");
});

test("query metrik yang gagal hanya membuat metrik itu null", async () => {
  const m = await collectMetrics("postgres", async (sql) => {
    if (sql.includes("pg_database_size")) throw new Error("permission denied");
    if (sql.includes("max_connections")) return [{ used: 3, max: 10 }];
    return [];
  });
  assert.equal(m.size_bytes, null);
  assert.equal(m.conn_used, 3);
  assert.equal(await collectMetrics("redis", async () => []), null);
});

test("laju per detik dari selisih sampel, dan dilewati saat penghitung turun", () => {
  const at = (min) => new Date(Date.parse("2026-09-27T00:00:00Z") + min * 60_000);
  const s = toSeries([
    { created_at: at(0), metrics: { queries_total: 1000, conn_used: 5, conn_max: 20 } },
    { created_at: at(5), metrics: { queries_total: 4000 } },
    { created_at: at(10), metrics: { queries_total: 100 } }, // server restart
    { created_at: at(15), metrics: { queries_total: 700 } },
  ]);
  assert.deepEqual(s.map((p) => p.qps), [null, 10, null, 2]);
  assert.equal(s[0].conn_pct, 25);
  assert.equal(s[1].conn_pct, null);
});

test("deret panjang diperkecil tanpa kehilangan titik terakhir", () => {
  const series = Array.from({ length: 8640 }, (_, i) => ({ i }));
  const out = downsample(series);
  assert.ok(out.length <= 600);
  assert.equal(out.at(-1).i, 8639);
  assert.equal(downsample(series.slice(0, 10)).length, 10);
});
