import test from "node:test";
import assert from "node:assert/strict";
import { parsePath, runAssertion, describeAssertion, operatorNeedsValue } from "../src/lib/assertion.js";

// Monitor tiruan seperlunya: runAssertion hanya membaca tiga field ini
const mon = (path, op, value) => ({ assertion_path: path, assertion_operator: op, assertion_value: value });

test("parsePath membaca properti, indeks array, dan nama berkutip", () => {
  assert.deepEqual(parsePath("$"), []);
  assert.deepEqual(parsePath(""), []);
  assert.deepEqual(parsePath("$.status"), ["status"]);
  assert.deepEqual(parsePath("$.data.items[0].id"), ["data", "items", 0, "id"]);
  assert.deepEqual(parsePath("$['nama dengan spasi']"), ["nama dengan spasi"]);
  assert.deepEqual(parsePath("$.list[-1]"), ["list", -1]);
});

test("parsePath menolak bentuk yang tidak didukung", () => {
  assert.throws(() => parsePath("status"), /diawali/);
  assert.throws(() => parsePath("$.a["), /tidak ditutup/);
  assert.throws(() => parsePath("$.a[*]"), /Indeks tidak valid/);
  assert.throws(() => parsePath("$."), /kosong/);
});

test("body yang bukan JSON dianggap assertion gagal, bukan exception", () => {
  const r = runAssertion(mon("$.status", "eq", "ok"), "<html>bukan json</html>");
  assert.equal(r.ok, false);
  assert.match(r.message, /bukan JSON/);
});

test("path yang tidak valid dilaporkan sebagai kegagalan yang bisa dibaca", () => {
  const r = runAssertion(mon("status", "eq", "ok"), '{"status":"ok"}');
  assert.equal(r.ok, false);
  assert.match(r.message, /path tidak valid/);
});

test("eq membandingkan setelah menyamakan tipe dengan nilai aktual", () => {
  // Nilai dari form selalu string; angka dan boolean harus tetap cocok
  assert.equal(runAssertion(mon("$.count", "eq", "3"), '{"count":3}').ok, true);
  assert.equal(runAssertion(mon("$.ready", "eq", "true"), '{"ready":true}').ok, true);
  assert.equal(runAssertion(mon("$.ready", "eq", "false"), '{"ready":true}').ok, false);
  assert.equal(runAssertion(mon("$.status", "eq", "ok"), '{"status":"ok"}').ok, true);
  assert.equal(runAssertion(mon("$.status", "ne", "ok"), '{"status":"ok"}').ok, false);
});

test("pembanding numerik", () => {
  const body = '{"latency":120}';
  assert.equal(runAssertion(mon("$.latency", "lt", "200"), body).ok, true);
  assert.equal(runAssertion(mon("$.latency", "gt", "200"), body).ok, false);
  assert.equal(runAssertion(mon("$.latency", "gte", "120"), body).ok, true);
  assert.equal(runAssertion(mon("$.latency", "lte", "119"), body).ok, false);
});

test("contains bekerja untuk string maupun array", () => {
  assert.equal(runAssertion(mon("$.msg", "contains", "sehat"), '{"msg":"semua sehat"}').ok, true);
  assert.equal(runAssertion(mon("$.tags", "contains", "db"), '{"tags":["web","db"]}').ok, true);
  assert.equal(runAssertion(mon("$.tags", "contains", "cache"), '{"tags":["web","db"]}').ok, false);
});

test("regex yang tidak valid jadi kegagalan, bukan crash", () => {
  const r = runAssertion(mon("$.v", "regex", "("), '{"v":"apa saja"}');
  assert.equal(r.ok, false);
  assert.match(r.message, /Regex tidak valid/);
  assert.equal(runAssertion(mon("$.v", "regex", "^ok-\\d+$"), '{"v":"ok-42"}').ok, true);
});

test("exists dan notexists membedakan null dari tidak ada", () => {
  assert.equal(runAssertion(mon("$.a", "exists"), '{"a":null}').ok, true, "null tetap dianggap ada");
  assert.equal(runAssertion(mon("$.b", "exists"), '{"a":1}').ok, false);
  assert.equal(runAssertion(mon("$.b", "notexists"), '{"a":1}').ok, true);
  assert.equal(runAssertion(mon("$.a", "notexists"), '{"a":1}').ok, false);
});

test("path yang menembus nilai null tidak melempar", () => {
  const r = runAssertion(mon("$.a.b.c", "eq", "x"), '{"a":null}');
  assert.equal(r.ok, false);
  assert.match(r.message, /tidak ada di response/);
});

test("indeks di luar jangkauan dilaporkan sebagai tidak ada", () => {
  assert.equal(runAssertion(mon("$.items[5]", "exists"), '{"items":[1,2]}').ok, false);
  assert.equal(runAssertion(mon("$.items[-1]", "eq", "2"), '{"items":[1,2]}').ok, true);
});

test("describeAssertion dan operatorNeedsValue", () => {
  assert.equal(describeAssertion(mon("$.status", "eq", "ok")), '$.status eq "ok"');
  assert.equal(describeAssertion(mon("$.status", "exists")), "$.status exists");
  assert.equal(describeAssertion({ assertion_path: null }), null);
  assert.equal(operatorNeedsValue("exists"), false);
  assert.equal(operatorNeedsValue("eq"), true);
});
