import test from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, isEncrypted } from "../src/lib/crypto.js";

test("kredensial pulang-pergi tanpa berubah", () => {
  for (const plain of ["token-123", "admin:p@ssw0rd", "berisi spasi dan émoji 🔐", "x".repeat(2000)]) {
    assert.equal(decryptSecret(encryptSecret(plain)), plain);
  }
});

test("nilai kosong tidak ikut dienkripsi", () => {
  assert.equal(encryptSecret(""), null);
  assert.equal(encryptSecret(null), null);
  assert.equal(encryptSecret(undefined), null);
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(""), null);
});

test("hasil enkripsi berbeda tiap kali karena IV acak", () => {
  const a = encryptSecret("sama");
  const b = encryptSecret("sama");
  assert.notEqual(a, b, "ciphertext identik berarti IV tidak acak");
  assert.equal(decryptSecret(a), decryptSecret(b));
});

test("ciphertext yang diubah ditolak, bukan menghasilkan sampah", () => {
  // Itulah gunanya GCM: perubahan terdeteksi lewat authTag
  const stored = encryptSecret("token-asli");
  const parts = stored.split(":");
  parts[3] = Buffer.from("token-palsu").toString("base64");
  assert.equal(decryptSecret(parts.join(":")), null);
});

test("format tak dikenal dikembalikan sebagai null, bukan melempar", () => {
  // Satu kredensial rusak tidak boleh menjatuhkan seluruh scheduler
  for (const bad of ["plaintext lama", "v1:kurang:bagian", "v2:a:b:c", "v1:::", 12345]) {
    assert.equal(decryptSecret(bad), null);
  }
});

test("isEncrypted mengenali nilai yang sudah berformat v1", () => {
  assert.equal(isEncrypted(encryptSecret("x")), true);
  assert.equal(isEncrypted("plaintext"), false);
  assert.equal(isEncrypted(null), false);
});
