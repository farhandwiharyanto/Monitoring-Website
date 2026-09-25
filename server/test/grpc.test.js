import test from "node:test";
import assert from "node:assert/strict";
import { checkGrpc, grpcTarget, tidyError } from "../src/checks/grpc.js";

test("target gRPC memakai port 443 bila tidak disetel", () => {
  assert.equal(grpcTarget({ hostname: "api.example.com", port: 50051 }), "api.example.com:50051");
  assert.equal(grpcTarget({ hostname: "api.example.com" }), "api.example.com:443");
  assert.equal(grpcTarget({ hostname: "  " }), null);
  assert.equal(grpcTarget({}), null);
});

test("kalimat panjang grpc-js diringkas jadi penyebab terakhirnya", () => {
  const asli = "No connection established. Last error: Error: connect ECONNREFUSED 127.0.0.1:50999. Resolution note: ";
  assert.equal(tidyError({ message: asli }), "connect ECONNREFUSED 127.0.0.1:50999");
});

test("pesan yang sudah ringkas dibiarkan apa adanya", () => {
  assert.equal(tidyError({ details: "Deadline exceeded after 3s" }), "Deadline exceeded after 3s");
  assert.equal(tidyError({}), "gagal");
  assert.equal(tidyError(null), "gagal");
});

test("hostname kosong gagal tanpa membuka koneksi", async () => {
  const r = await checkGrpc({ hostname: "", timeout_seconds: 5 });
  assert.equal(r.ok, false);
  assert.match(r.message, /Hostname belum diisi/);
  assert.equal(r.ms, 0);
});

test("port tertutup gagal cepat dengan pesan yang bisa dibaca", async () => {
  const r = await checkGrpc({
    hostname: "127.0.0.1", port: 50999, timeout_seconds: 5,
    check_config: { grpc_tls: false },
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /ECONNREFUSED/);
  assert.ok(r.ms < 4000);
});
