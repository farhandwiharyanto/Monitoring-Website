import test from "node:test";
import assert from "node:assert/strict";
import { checkDatabase, sanitize } from "../src/checks/database.js";
import { encryptSecret } from "../src/lib/crypto.js";

test("password di dalam connection string disamarkan sebelum jadi pesan", () => {
  // Pesan check masuk ke heartbeat, yang terbaca viewer dan ikut ke export
  assert.equal(
    sanitize("gagal: postgresql://admin:sup3r-rahasia@db.internal:5432/app"),
    "gagal: postgresql://admin:***@db.internal:5432/app"
  );
  assert.equal(sanitize("redis://pengguna:abc123@10.0.0.5:6379"), "redis://pengguna:***@10.0.0.5:6379");
  assert.equal(sanitize("tanpa kredensial apa pun"), "tanpa kredensial apa pun");
});

test("pesan panjang dipotong supaya tidak membengkakkan tabel heartbeat", () => {
  assert.equal(sanitize("x".repeat(1000)).length, 300);
  assert.equal(sanitize(null), "");
});

test("tipe yang tidak dikenal gagal dengan rapi, bukan melempar", async () => {
  const r = await checkDatabase({ type: "oracle", timeout_seconds: 5 });
  assert.equal(r.ok, false);
  assert.match(r.message, /tidak dikenal/);
});

test("connection string kosong dilaporkan, bukan mencoba menyambung", async () => {
  const r = await checkDatabase({ type: "postgres", timeout_seconds: 5, conn_secret: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /belum diisi/);
});

test("kredensial yang tidak bisa didekripsi diperlakukan sama dengan kosong", async () => {
  const r = await checkDatabase({ type: "mysql", timeout_seconds: 5, conn_secret: "v1:rusak:rusak:rusak" });
  assert.equal(r.ok, false);
  assert.match(r.message, /belum diisi|tidak bisa dibuka/);
});

test("host yang tidak menjawab dihentikan oleh timeout sendiri", async () => {
  // 10.255.255.1 tidak terjangkau; sebagian driver mengabaikan timeout-nya
  // sendiri saat macet pada tahap TCP, jadi check punya timer sendiri.
  const r = await checkDatabase({
    type: "postgres",
    timeout_seconds: 1,
    conn_secret: encryptSecret("postgres://a:b@10.255.255.1:5432/x"),
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /Timeout|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/);
  assert.ok(r.ms < 4000, `check harus berhenti sendiri, bukan menggantung (${r.ms}ms)`);
});
