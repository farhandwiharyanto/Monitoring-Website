import test from "node:test";
import assert from "node:assert/strict";
import { checkKafka, parseBrokers, tidyKafkaError } from "../src/checks/kafka.js";

test("daftar broker dipisah koma dan dirapikan", () => {
  assert.deepEqual(parseBrokers("a:9092, b:9092 ,c:9092"), ["a:9092", "b:9092", "c:9092"]);
  assert.deepEqual(parseBrokers("a:9092"), ["a:9092"]);
  assert.deepEqual(parseBrokers(" , , "), []);
  assert.deepEqual(parseBrokers(null), []);
});

test("jumlah broker dibatasi supaya satu check tidak menyapu ratusan alamat", () => {
  const banyak = Array.from({ length: 50 }, (_, i) => `b${i}:9092`).join(",");
  assert.equal(parseBrokers(banyak).length, 20);
});

test("error kafkajs diambil kalimat pertamanya saja", () => {
  const panjang = "Connection error: connect ECONNREFUSED 127.0.0.1:9092\n  at Socket.onError\n  at emit";
  assert.equal(tidyKafkaError({ message: panjang }), "Connection error: connect ECONNREFUSED 127.0.0.1:9092");
  assert.equal(tidyKafkaError({}), "gagal");
  assert.equal(tidyKafkaError(null), "gagal");
});

test("tanpa broker, check gagal tanpa membuka koneksi", async () => {
  const r = await checkKafka({ timeout_seconds: 5, check_config: {} });
  assert.equal(r.ok, false);
  assert.match(r.message, /broker belum diisi/);
  assert.equal(r.ms, 0);
});

test("broker yang menolak koneksi gagal cepat", async () => {
  const r = await checkKafka({ timeout_seconds: 5, check_config: { kafka_brokers: "127.0.0.1:59999" } });
  assert.equal(r.ok, false);
  assert.match(r.message, /ECONNREFUSED|Connection error/);
  assert.ok(r.ms < 4000);
});
