import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { prisma, resetDb, createMonitor } from "./helpers.js";
import { startEscalation, runDueDeliveries, acknowledge, stopEscalation, policyFor } from "../src/lib/escalation.js";

// Rantai eskalasi diuji ujung ke ujung: tingkat dikirim ke webhook lokal
// sungguhan, statusnya dibaca kembali dari database.

let server;
let received = [];
let url;

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push(JSON.parse(body));
      res.end("ok");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}/hook`;
});
beforeEach(async () => {
  // Pencatatan riwayat notifikasi tidak di-await oleh pengirimnya; beri waktu
  // selesai sebelum tabelnya dikosongkan.
  await new Promise((r) => setTimeout(r, 50));
  await resetDb();
  received = [];
});
after(async () => {
  server.close();
  await prisma.$disconnect();
});

const later = (minutes) => new Date(Date.now() + minutes * 60_000);

async function setup(steps, { policy = {} } = {}) {
  const channel = await prisma.notification.create({ data: { name: "hook", type: "webhook", config: { url } } });
  const p = await prisma.escalationPolicy.create({
    data: {
      name: "utama",
      is_default: true,
      ...policy,
      steps: { create: steps.map((s, i) => ({ step_order: i, target: "channel", notification_id: channel.id, ...s })) },
    },
  });
  const monitor = await createMonitor();
  const incident = await prisma.incident.create({ data: { monitor_id: monitor.id, cause: "timeout" } });
  return { channel, policy: p, monitor, incident };
}

const deliveries = (escalationId) =>
  prisma.escalationDelivery.findMany({ where: { escalation_id: escalationId }, orderBy: { step_order: "asc" } });

// startEscalation menjalankan putaran pertama di latar belakang; tunggu sampai
// putaran itu selesai supaya tidak bertabrakan dengan putaran dari tes.
async function settle(escalationId) {
  for (let i = 0; i < 100; i += 1) {
    const rows = await deliveries(escalationId);
    if (rows.every((d) => d.status !== "pending" || d.due_at > new Date())) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await new Promise((r) => setTimeout(r, 50));
}

test("tingkat dikirim berurutan sesuai jeda, lalu rantai ditandai habis", async () => {
  const { monitor, incident } = await setup([{ delay_minutes: 0 }, { delay_minutes: 10 }]);
  const esc = await startEscalation(monitor, incident);
  await settle(esc.id);

  let rows = await deliveries(esc.id);
  assert.deepEqual(rows.map((d) => d.status), ["sent", "pending"]);
  assert.equal(received.length, 1);
  assert.equal(received[0].escalation.level, 1);
  assert.equal(received[0].escalation.level_count, 2);

  await runDueDeliveries(later(5));
  assert.equal((await deliveries(esc.id))[1].status, "pending");

  await runDueDeliveries(later(11));
  rows = await deliveries(esc.id);
  assert.deepEqual(rows.map((d) => d.status), ["sent", "sent"]);
  assert.equal(received.length, 2);

  const done = await prisma.escalation.findUnique({ where: { id: esc.id } });
  assert.equal(done.stopped_reason, "exhausted");
});

test("acknowledge membatalkan tingkat yang belum dikirim", async () => {
  const { monitor, incident } = await setup([{ delay_minutes: 0 }, { delay_minutes: 10 }]);
  const esc = await startEscalation(monitor, incident);
  await settle(esc.id);

  const res = await acknowledge({ token: esc.ack_token }, "budi");
  assert.equal(res.ok, true);
  assert.deepEqual((await deliveries(esc.id)).map((d) => d.status), ["sent", "cancelled"]);

  await runDueDeliveries(later(11));
  assert.equal(received.length, 1);

  const again = await acknowledge({ incidentId: incident.id }, "ani");
  assert.equal(again.already, true);
  assert.equal(again.by, "budi");
});

test("rantai yang dihentikan karena monitor pulih tidak bisa di-ack", async () => {
  const { monitor, incident } = await setup([{ delay_minutes: 10 }]);
  const esc = await startEscalation(monitor, incident);
  await settle(esc.id);
  await stopEscalation(incident.id, "recovered");

  assert.deepEqual((await deliveries(esc.id)).map((d) => d.status), ["cancelled"]);
  const res = await acknowledge({ token: esc.ack_token }, "budi");
  assert.equal(res.status, 409);
});

test("tingkat on-call tanpa orang bertugas dilewati, tingkat berikutnya tetap jalan", async () => {
  const schedule = await prisma.onCallSchedule.create({ data: { name: "tim" } });
  const { monitor, incident } = await setup([
    { delay_minutes: 1, target: "oncall", schedule_id: schedule.id, notification_id: null },
    { delay_minutes: 2 },
  ]);
  const esc = await startEscalation(monitor, incident);
  await settle(esc.id);
  await runDueDeliveries(later(3));

  const rows = await deliveries(esc.id);
  assert.deepEqual(rows.map((d) => d.status), ["skipped", "sent"]);
  assert.match(rows[0].error, /Tidak ada shift/);
});

test("tingkat on-call dikirim ke kontak orang yang sedang bertugas", async () => {
  const contact = await prisma.notification.create({ data: { name: "pribadi", type: "webhook", config: { url } } });
  const user = await prisma.user.create({ data: { username: "budi", password_hash: "x", oncall_notification_id: contact.id } });
  const schedule = await prisma.onCallSchedule.create({ data: { name: "tim" } });
  await prisma.onCallShift.create({
    data: { schedule_id: schedule.id, user_id: user.id, start_at: new Date(Date.now() - 3600_000), end_at: later(120) },
  });
  const { monitor, incident } = await setup([{ delay_minutes: 1, target: "oncall", schedule_id: schedule.id, notification_id: null }]);
  const esc = await startEscalation(monitor, incident);
  await settle(esc.id);
  await runDueDeliveries(later(2));

  const [row] = await deliveries(esc.id);
  assert.equal(row.status, "sent");
  assert.equal(row.notification_id, contact.id);
  assert.match(row.target_label, /budi/);
});

test("policy pilihan yang nonaktif tidak jatuh ke default", async () => {
  const { monitor } = await setup([{ delay_minutes: 0 }]);
  const off = await prisma.escalationPolicy.create({
    data: { name: "mati", active: false, steps: { create: [{ delay_minutes: 0, target: "channel" }] } },
  });
  assert.ok(await policyFor(monitor));
  assert.equal(await policyFor({ ...monitor, escalation_policy_id: off.id }), null);
});

test("satu incident hanya punya satu rantai", async () => {
  const { monitor, incident } = await setup([{ delay_minutes: 10 }]);
  const first = await startEscalation(monitor, incident);
  assert.ok(first);
  assert.equal(await startEscalation(monitor, incident), null);
  await settle(first.id);
});

test("rantai diulang sesuai policy sebelum ditandai habis", async () => {
  const { monitor, incident } = await setup([{ delay_minutes: 1 }], { policy: { repeat_times: 1, repeat_minutes: 30 } });
  const esc = await startEscalation(monitor, incident);
  await settle(esc.id);

  await runDueDeliveries(later(2));
  let rows = await deliveries(esc.id);
  assert.deepEqual(rows.map((d) => [d.round, d.status]), [[1, "sent"], [2, "pending"]]);
  assert.equal((await prisma.escalation.findUnique({ where: { id: esc.id } })).stopped_at, null);

  // Putaran kedua baru jatuh tempo 30 menit + jeda tingkat setelah putaran pertama habis
  await runDueDeliveries(later(20));
  assert.equal((await deliveries(esc.id))[1].status, "pending");

  await runDueDeliveries(later(40));
  rows = await deliveries(esc.id);
  assert.deepEqual(rows.map((d) => d.status), ["sent", "sent"]);
  assert.equal(received.at(-1).escalation.round, 2);
  assert.equal((await prisma.escalation.findUnique({ where: { id: esc.id } })).stopped_reason, "exhausted");
});

test("acknowledge di tengah pengulangan menghentikan putaran berikutnya", async () => {
  const { monitor, incident } = await setup([{ delay_minutes: 1 }], { policy: { repeat_times: 3, repeat_minutes: 5 } });
  const esc = await startEscalation(monitor, incident);
  await settle(esc.id);
  await runDueDeliveries(later(2));
  await acknowledge({ token: esc.ack_token }, "budi");
  await runDueDeliveries(later(60));

  const rows = await deliveries(esc.id);
  assert.deepEqual(rows.map((d) => [d.round, d.status]), [[1, "sent"], [2, "cancelled"]]);
});
