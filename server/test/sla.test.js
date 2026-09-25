import test from "node:test";
import assert from "node:assert/strict";
import { monthRange, parseMonth, monthKey, humanDuration } from "../src/lib/sla.js";

// Batas bulan pada laporan SLA memakai WAKTU LOKAL server, sedangkan Postgres
// menyimpan UTC. Tes ini mengunci perilaku itu supaya perubahan pada salah satu
// sisi tidak diam-diam menggeser batas periode laporan.

test("monthRange memberi awal bulan sampai awal bulan berikutnya, waktu lokal", () => {
  const { from, to } = monthRange(new Date(2026, 8, 15, 13, 45));
  assert.equal(from.getFullYear(), 2026);
  assert.equal(from.getMonth(), 8); // September
  assert.equal(from.getDate(), 1);
  assert.equal(from.getHours(), 0);
  assert.equal(from.getMinutes(), 0);
  assert.equal(to.getMonth(), 9); // Oktober
  assert.equal(to.getDate(), 1);
});

test("monthRange menyeberang tahun dengan benar", () => {
  const { from, to } = monthRange(new Date(2026, 11, 31, 23, 59));
  assert.equal(from.getMonth(), 11);
  assert.equal(from.getFullYear(), 2026);
  assert.equal(to.getFullYear(), 2027);
  assert.equal(to.getMonth(), 0);
});

test("batas bulan adalah tengah malam lokal, bukan tengah malam UTC", () => {
  const { from } = monthRange(new Date(2026, 8, 15));
  // Bila mesin tidak berada di UTC, jam UTC-nya pasti bukan 00:00 —
  // itulah selisih yang disebut di docs/rencana.md dan sengaja dipertahankan.
  const offsetMinutes = from.getTimezoneOffset();
  if (offsetMinutes !== 0) assert.notEqual(from.getUTCHours(), 0);
  assert.equal(from.getHours(), 0);
});

test("parseMonth menerima YYYY-MM dan menolak sisanya", () => {
  const r = parseMonth("2026-02");
  assert.equal(r.from.getFullYear(), 2026);
  assert.equal(r.from.getMonth(), 1);
  assert.equal(r.to.getMonth(), 2);

  assert.equal(parseMonth("2026-13"), null, "bulan 13 tidak ada");
  assert.equal(parseMonth("2026-00"), null, "bulan 0 tidak ada");
  assert.equal(parseMonth("2026-2"), null, "harus dua digit");
  assert.equal(parseMonth("bukan-bulan"), null);
  assert.equal(parseMonth(""), null);
  assert.equal(parseMonth(null), null);
});

test("parseMonth dan monthKey saling berbalikan", () => {
  for (const key of ["2026-01", "2026-09", "2026-12"]) {
    assert.equal(monthKey(parseMonth(key).from), key);
  }
});

test("humanDuration memakai satuan Indonesia dan membulatkan ke bawah", () => {
  assert.equal(humanDuration(0), "0s");
  assert.equal(humanDuration(45), "45s");
  // Pembulatan terjadi lebih dulu, jadi 59,6 detik sudah dihitung sebagai satu menit
  assert.equal(humanDuration(59.4), "59s");
  assert.equal(humanDuration(59.6), "1m");
  assert.equal(humanDuration(90), "1m");
  assert.equal(humanDuration(3600), "1j 0m");
  assert.equal(humanDuration(8100), "2j 15m");
  assert.equal(humanDuration(86400), "1h 0j");
  assert.equal(humanDuration(90000), "1h 1j");
});

test("humanDuration aman untuk nilai kosong dan negatif", () => {
  assert.equal(humanDuration(null), "0s");
  assert.equal(humanDuration(undefined), "0s");
  assert.equal(humanDuration(-10), "0s");
});
