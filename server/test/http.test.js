import test from "node:test";
import assert from "node:assert/strict";
import { statusMatches, buildHeaders } from "../src/checks/http.js";
import { encryptSecret } from "../src/lib/crypto.js";

test("statusMatches memahami range, daftar, dan kode tunggal", () => {
  assert.equal(statusMatches(200, "200-299"), true);
  assert.equal(statusMatches(299, "200-299"), true);
  assert.equal(statusMatches(300, "200-299"), false);
  assert.equal(statusMatches(404, "404"), true);
  assert.equal(statusMatches(401, "200-299,401,403"), true);
  assert.equal(statusMatches(402, "200-299,401,403"), false);
  assert.equal(statusMatches(201, " 200 - 299 "), true, "spasi di sekitar range diabaikan");
});

test("statusMatches memakai 200-299 bila tidak diisi", () => {
  assert.equal(statusMatches(204, ""), true);
  assert.equal(statusMatches(204, null), true);
  assert.equal(statusMatches(500, undefined), false);
});

test("buildHeaders selalu menyertakan User-Agent", () => {
  const h = buildHeaders({});
  assert.match(h["User-Agent"], /Pulsewatch/);
});

test("header kustom dipakai, header transport ditolak", () => {
  const h = buildHeaders({
    http_headers: { "X-Api-Key": "rahasia", Host: "penyerang.example", "content-length": "0", "": "kosong" },
  });
  assert.equal(h["X-Api-Key"], "rahasia");
  assert.equal("Host" in h, false, "Host tidak boleh ditimpa dari konfigurasi monitor");
  assert.equal("content-length" in h, false);
  assert.equal("" in h, false);
});

test("http_headers yang bukan object polos diabaikan", () => {
  for (const bad of [null, "bukan object", ["a"], 42]) {
    const h = buildHeaders({ http_headers: bad });
    assert.deepEqual(Object.keys(h), ["User-Agent"]);
  }
});

test("kredensial terenkripsi jadi header Authorization", () => {
  const basic = buildHeaders({ auth_type: "basic", auth_secret: encryptSecret("admin:rahasia") });
  assert.equal(basic.Authorization, `Basic ${Buffer.from("admin:rahasia").toString("base64")}`);

  const bearer = buildHeaders({ auth_type: "bearer", auth_secret: encryptSecret("token-123") });
  assert.equal(bearer.Authorization, "Bearer token-123");
});

test("kredensial yang tidak bisa dibuka tidak menghentikan request", () => {
  // Mis. ENCRYPTION_KEY berubah: request tetap dikirim tanpa auth supaya
  // kegagalannya terlihat sebagai 401 pada pesan heartbeat, bukan crash.
  const h = buildHeaders({ auth_type: "bearer", auth_secret: "v1:rusak:rusak:rusak" });
  assert.equal("Authorization" in h, false);
});

test("auth_type none tidak menambahkan Authorization", () => {
  const h = buildHeaders({ auth_type: "none", auth_secret: encryptSecret("token") });
  assert.equal("Authorization" in h, false);
});
