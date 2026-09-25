import test from "node:test";
import assert from "node:assert/strict";
import { crossedThreshold, locationFilter } from "../src/scheduler.js";
import { config } from "../src/config.js";

// Ambang peringatan sertifikat: satu alert per ambang yang dilewati, makin
// mendesak makin kecil angkanya. Salah di sini berarti spam alert tiap check
// atau justru tidak ada peringatan sama sekali sebelum sertifikat mati.

test("belum ada ambang yang dilewati selama masih lama", () => {
  assert.equal(crossedThreshold(90), null);
  assert.equal(crossedThreshold(31), null);
});

test("ambang terkecil yang sudah dilewati yang dipakai", () => {
  assert.equal(crossedThreshold(30), 30, "tepat di ambang sudah terhitung");
  assert.equal(crossedThreshold(20), 30);
  assert.equal(crossedThreshold(14), 14);
  assert.equal(crossedThreshold(10), 14);
  assert.equal(crossedThreshold(7), 7);
  assert.equal(crossedThreshold(5), 7);
  assert.equal(crossedThreshold(3), 3);
  assert.equal(crossedThreshold(1), 3);
});

test("sertifikat yang sudah kedaluwarsa tetap memakai ambang paling mendesak", () => {
  assert.equal(crossedThreshold(0), 3);
  assert.equal(crossedThreshold(-30), 3);
});

test("daftar ambang bisa diganti", () => {
  assert.equal(crossedThreshold(10, [60, 20]), 20);
  assert.equal(crossedThreshold(70, [60, 20]), null);
  assert.equal(crossedThreshold(5, []), null, "tanpa ambang berarti tidak pernah memperingatkan");
});

// Heartbeat sebelum multi-location ada tidak punya label lokasi. Baris itu
// milik lokasi primary, jadi penyaringnya harus ikut menangkap location NULL —
// kalau tidak, riwayat lama hilang dari perhitungan uptime.
test("lokasi primary ikut memiliki baris lama tanpa label", () => {
  const f = locationFilter(config.primaryLocation);
  assert.deepEqual(f, { OR: [{ location: null }, { location: config.primaryLocation }] });
});

test("lokasi lain hanya melihat barisnya sendiri", () => {
  assert.deepEqual(locationFilter("jakarta"), { location: "jakarta" });
});
