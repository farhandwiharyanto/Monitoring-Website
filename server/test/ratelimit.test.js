import test from "node:test";
import assert from "node:assert/strict";
import { recordFailure, lockRemaining, resetKey, blockWhenLocked } from "../src/lib/ratelimit.js";
import { config } from "../src/config.js";

// Tiap tes memakai kunci sendiri supaya jendelanya tidak saling mencemari
let n = 0;
const freshKey = () => `uji-${process.pid}-${n++}`;

test("belum terkunci sebelum batas percobaan terlampaui", () => {
  const key = freshKey();
  for (let i = 1; i < config.loginMaxAttempts; i++) {
    assert.equal(recordFailure(key), 0, `percobaan gagal ke-${i} belum boleh mengunci`);
  }
  assert.equal(lockRemaining(key), 0);
});

test("percobaan terakhir mengunci dan menyebut sisa waktunya", () => {
  const key = freshKey();
  let wait = 0;
  for (let i = 0; i < config.loginMaxAttempts; i++) wait = recordFailure(key);
  assert.ok(wait > 0, "harus mengembalikan sisa detik kunci");
  assert.ok(lockRemaining(key) > 0);
  assert.ok(lockRemaining(key) <= config.loginLockSeconds);
});

test("login berhasil menghapus penghitungnya", () => {
  const key = freshKey();
  for (let i = 0; i < config.loginMaxAttempts; i++) recordFailure(key);
  resetKey(key);
  assert.equal(lockRemaining(key), 0);
});

test("kunci yang tidak dikenal tidak pernah terkunci", () => {
  assert.equal(lockRemaining(freshKey()), 0);
});

test("middleware menolak dengan 429 dan Retry-After saat terkunci", () => {
  const key = freshKey();
  for (let i = 0; i < config.loginMaxAttempts; i++) recordFailure(key);

  const headers = {};
  let status = null;
  let body = null;
  const res = {
    set: (k, v) => (headers[k] = v),
    status(code) { status = code; return this; },
    json: (b) => (body = b),
  };
  let lanjut = false;
  blockWhenLocked(() => [key])({}, res, () => (lanjut = true));

  assert.equal(lanjut, false, "permintaan tidak boleh diteruskan");
  assert.equal(status, 429);
  assert.ok(Number(headers["Retry-After"]) > 0);
  assert.match(body.error, /Terlalu banyak percobaan/);
});

test("middleware meneruskan permintaan saat tidak ada kunci yang terkunci", () => {
  let lanjut = false;
  blockWhenLocked(() => [freshKey(), freshKey()])({}, { set: () => {} }, () => (lanjut = true));
  assert.equal(lanjut, true);
});
