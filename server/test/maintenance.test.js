import test from "node:test";
import assert from "node:assert/strict";
import { isWindowActive } from "../src/lib/maintenance.js";

// Semua tanggal dibangun sebagai waktu lokal, sama seperti yang dibaca
// isWindowActive lewat getHours()/getDay(), sehingga tes tidak bergantung
// pada zona waktu mesin yang menjalankannya.
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0);

const win = (over) => ({
  active: true,
  recurring: "none",
  days_of_week: null,
  start_at: at(2026, 1, 1, 22, 0),
  end_at: at(2026, 1, 2, 1, 0),
  ...over,
});

test("window sekali jalan hanya aktif di dalam rentangnya", () => {
  const w = win({ start_at: at(2026, 1, 1, 10, 0), end_at: at(2026, 1, 1, 12, 0) });
  assert.equal(isWindowActive(w, at(2026, 1, 1, 9, 59)), false);
  assert.equal(isWindowActive(w, at(2026, 1, 1, 11, 0)), true);
  assert.equal(isWindowActive(w, at(2026, 1, 1, 12, 1)), false);
});

test("window yang dinonaktifkan tidak pernah aktif", () => {
  const w = win({ active: false, start_at: at(2026, 1, 1, 10, 0), end_at: at(2026, 1, 1, 12, 0) });
  assert.equal(isWindowActive(w, at(2026, 1, 1, 11, 0)), false);
});

test("window harian berulang pada jam yang sama di hari berikutnya", () => {
  const w = win({ recurring: "daily", start_at: at(2026, 1, 1, 10, 0), end_at: at(2026, 1, 1, 11, 0) });
  assert.equal(isWindowActive(w, at(2026, 3, 15, 10, 30)), true);
  assert.equal(isWindowActive(w, at(2026, 3, 15, 11, 30)), false);
});

test("window harian yang melintasi tengah malam masih aktif di dini hari", () => {
  // 23:00 sampai 01:00 keesokan harinya
  const w = win({ recurring: "daily", start_at: at(2026, 1, 1, 23, 0), end_at: at(2026, 1, 2, 1, 0) });
  assert.equal(isWindowActive(w, at(2026, 2, 10, 23, 30)), true, "sebelum tengah malam");
  assert.equal(isWindowActive(w, at(2026, 2, 11, 0, 30)), true, "sesudah tengah malam");
  assert.equal(isWindowActive(w, at(2026, 2, 11, 2, 0)), false, "sudah lewat");
});

test("window berulang belum berlaku sebelum tanggal mulainya", () => {
  const w = win({ recurring: "daily", start_at: at(2026, 6, 1, 10, 0), end_at: at(2026, 6, 1, 11, 0) });
  assert.equal(isWindowActive(w, at(2026, 5, 20, 10, 30)), false);
});

test("window mingguan hanya aktif pada hari yang dipilih", () => {
  // 5 Januari 2026 adalah Senin; window Senin & Rabu, 10:00-11:00
  const w = win({ recurring: "weekly", days_of_week: "1,3", start_at: at(2026, 1, 5, 10, 0), end_at: at(2026, 1, 5, 11, 0) });
  assert.equal(isWindowActive(w, at(2026, 1, 12, 10, 30)), true, "Senin berikutnya");
  assert.equal(isWindowActive(w, at(2026, 1, 14, 10, 30)), true, "Rabu");
  assert.equal(isWindowActive(w, at(2026, 1, 13, 10, 30)), false, "Selasa");
});

test("window mingguan tanpa days_of_week memakai hari tanggal mulainya", () => {
  const w = win({ recurring: "weekly", days_of_week: "", start_at: at(2026, 1, 5, 10, 0), end_at: at(2026, 1, 5, 11, 0) });
  assert.equal(isWindowActive(w, at(2026, 1, 12, 10, 30)), true, "Senin");
  assert.equal(isWindowActive(w, at(2026, 1, 13, 10, 30)), false, "Selasa");
});

test("window mingguan yang melintasi tengah malam dihitung dari hari mulainya", () => {
  // Senin 23:00 sampai Selasa 01:00
  const w = win({ recurring: "weekly", days_of_week: "1", start_at: at(2026, 1, 5, 23, 0), end_at: at(2026, 1, 6, 1, 0) });
  assert.equal(isWindowActive(w, at(2026, 1, 13, 0, 30)), true, "dini hari Selasa masih milik shift Senin");
  assert.equal(isWindowActive(w, at(2026, 1, 14, 0, 30)), false, "dini hari Rabu tidak");
});

test("durasi nol atau terbalik tidak pernah aktif", () => {
  const w = win({ recurring: "daily", start_at: at(2026, 1, 1, 10, 0), end_at: at(2026, 1, 1, 10, 0) });
  assert.equal(isWindowActive(w, at(2026, 1, 2, 10, 0)), false);
});
