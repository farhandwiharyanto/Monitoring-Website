import test from "node:test";
import assert from "node:assert/strict";
import { base32Encode, base32Decode, codeForStep, verifyCode, stepAt, newRecoveryCodes, hashRecovery, consumeRecovery } from "../src/lib/totp.js";

// Vektor uji RFC 6238 (SHA-1) dengan secret ASCII "12345678901234567890",
// dipotong ke 6 digit terakhir seperti yang dipakai aplikasi authenticator.
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("base32 bolak-balik dan sesuai contoh RFC", () => {
  assert.equal(SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(base32Decode(SECRET).toString(), "12345678901234567890");
  assert.equal(base32Decode("gezd gnbv-gy3tqojq gezdgnbvgy3tqojq=").toString(), "12345678901234567890");
});

test("kode sama dengan vektor uji RFC 6238", () => {
  for (const [time, code] of [[59, "287082"], [1111111109, "081804"], [1234567890, "005924"], [2000000000, "279037"]]) {
    assert.equal(codeForStep(SECRET, stepAt(time * 1000)), code, `t=${time}`);
  }
});

test("verifikasi menoleransi satu langkah dan menolak yang lebih jauh", () => {
  const now = 1234567890 * 1000;
  const step = stepAt(now);
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step - 1), { now }), step - 1);
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step + 1), { now }), step + 1);
  assert.equal(verifyCode(SECRET, codeForStep(SECRET, step - 2), { now }), null);
  assert.equal(verifyCode(SECRET, "12345", { now }), null);
  assert.equal(verifyCode(SECRET, "abcdef", { now }), null);
});

test("kode yang sudah dipakai tidak bisa dipakai lagi", () => {
  const now = 1234567890 * 1000;
  const code = codeForStep(SECRET, stepAt(now));
  const used = verifyCode(SECRET, code, { now });
  assert.equal(verifyCode(SECRET, code, { now, lastStep: used }), null);
});

test("kode cadangan sekali pakai, format bebas spasi dan huruf besar", () => {
  const codes = newRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.match(codes[0], /^[0-9a-f]{5}-[0-9a-f]{5}$/);
  const hashes = codes.map(hashRecovery);
  const rest = consumeRecovery(hashes, ` ${codes[3].toUpperCase().replace("-", " ")} `);
  assert.equal(rest.length, 9);
  assert.equal(consumeRecovery(rest, codes[3]), null);
  assert.equal(consumeRecovery(hashes, "salah"), null);
});
