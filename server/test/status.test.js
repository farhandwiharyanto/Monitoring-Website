import test from "node:test";
import assert from "node:assert/strict";
import { STATUS, DISPLAY_STATUS, evaluateLatency } from "../src/lib/status.js";

test("status tampilan melanjutkan nilai status heartbeat", () => {
  // Kalau ini bergeser, seluruh riwayat heartbeat lama berubah arti
  assert.equal(DISPLAY_STATUS.DOWN, STATUS.DOWN);
  assert.equal(DISPLAY_STATUS.UP, STATUS.UP);
  assert.equal(DISPLAY_STATUS.PENDING, STATUS.PENDING);
  assert.equal(DISPLAY_STATUS.PAUSED, 3);
  assert.equal(DISPLAY_STATUS.MAINTENANCE, 4);
  assert.equal(DISPLAY_STATUS.DEGRADED, 5);
  assert.equal(STATUS.DEGRADED, undefined, "degraded tidak boleh jadi status heartbeat");
});

test("tanpa ambang, monitor tidak pernah degraded", () => {
  for (const thresholdMs of [null, undefined, 0, -1]) {
    assert.equal(evaluateLatency({ thresholdMs, ms: 99999, wasDegraded: false }), false);
  }
});

test("respons tanpa angka (mis. monitor push) tidak dinilai", () => {
  assert.equal(evaluateLatency({ thresholdMs: 500, ms: null, wasDegraded: false }), false);
  assert.equal(evaluateLatency({ thresholdMs: 500, ms: undefined, wasDegraded: true }), false);
});

test("masuk degraded hanya di atas ambang", () => {
  assert.equal(evaluateLatency({ thresholdMs: 500, ms: 501, wasDegraded: false }), true);
  assert.equal(evaluateLatency({ thresholdMs: 500, ms: 500, wasDegraded: false }), false, "tepat di ambang belum degraded");
  assert.equal(evaluateLatency({ thresholdMs: 500, ms: 499, wasDegraded: false }), false);
});

test("keluar degraded butuh turun di bawah ambang pemulihan", () => {
  // Histeresis: masuk di atas 500 ms, keluar baru di bawah 450 ms
  const degraded = (ms) => evaluateLatency({ thresholdMs: 500, ms, wasDegraded: true });
  assert.equal(degraded(480), true, "masih di zona histeresis, tetap degraded");
  assert.equal(degraded(450), false);
  assert.equal(degraded(400), false);
});

test("tanpa histeresis, nilai di sekitar ambang akan bolak-balik", () => {
  // Inilah yang dicegah: dengan rasio 1, 501 ms lalu 499 ms menghasilkan dua
  // perpindahan status — dan karenanya dua alert — dalam dua interval check.
  const tanpa = (ms, wasDegraded) => evaluateLatency({ thresholdMs: 500, ms, wasDegraded, recoveryRatio: 1 });
  assert.equal(tanpa(501, false), true);
  assert.equal(tanpa(499, true), false);

  const dengan = (ms, wasDegraded) => evaluateLatency({ thresholdMs: 500, ms, wasDegraded });
  assert.equal(dengan(501, false), true);
  assert.equal(dengan(499, true), true, "histeresis menahannya tetap degraded");
});
