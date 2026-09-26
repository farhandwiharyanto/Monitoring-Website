import test from "node:test";
import assert from "node:assert/strict";
import { generateKey, hashKey, looksLikeApiKey, publicApiKey, API_KEY_PATTERN, rateLimitApiKey } from "../src/lib/apikey.js";
import { config } from "../src/config.js";

test("kunci yang dibuat cocok dengan polanya dan hash-nya konsisten", () => {
  const { key, key_hash, prefix } = generateKey();
  assert.match(key, API_KEY_PATTERN);
  assert.equal(key_hash, hashKey(key));
  assert.equal(prefix, key.slice(0, 11));
  assert.equal(key_hash.length, 64);
});

test("dua kunci tidak pernah sama", () => {
  const keys = new Set(Array.from({ length: 50 }, () => generateKey().key));
  assert.equal(keys.size, 50);
});

test("looksLikeApiKey memisahkan kunci dari JWT", () => {
  assert.equal(looksLikeApiKey(generateKey().key), true);
  assert.equal(looksLikeApiKey("pw_" + "A".repeat(64)), false, "hex harus huruf kecil");
  assert.equal(looksLikeApiKey("pw_terlalupendek"), false);
  assert.equal(looksLikeApiKey("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def"), false);
  assert.equal(looksLikeApiKey(null), false);
});

test("publicApiKey tidak pernah membocorkan hash", () => {
  const view = publicApiKey({ id: 1, label: "CI", prefix: "pw_abc", scope: "read", key_hash: "RAHASIA", revoked_at: null });
  assert.equal("key_hash" in view, false);
  assert.equal("key" in view, false);
  assert.equal(view.active, true);
  assert.equal(publicApiKey({ revoked_at: new Date() }).active, false);
});

test("rate limit menolak setelah kuota habis dan menyebut waktu tunggu", async () => {
  const id = 987654; // id khusus tes, jendelanya terpisah dari yang lain
  for (let i = 0; i < config.apiKeyMaxRequests; i++) {
    assert.equal((await rateLimitApiKey(id)).allowed, true, `permintaan ke-${i + 1} seharusnya lolos`);
  }
  const blocked = await rateLimitApiKey(id);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfter > 0, "harus memberi tahu kapan boleh mencoba lagi");
});

test("sisa kuota berkurang satu per satu", async () => {
  const id = 987655;
  assert.equal((await rateLimitApiKey(id)).remaining, config.apiKeyMaxRequests - 1);
  assert.equal((await rateLimitApiKey(id)).remaining, config.apiKeyMaxRequests - 2);
});
