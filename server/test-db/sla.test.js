import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, resetDb, createMonitor, minutesAgo } from "./helpers.js";
import { slaReport } from "../src/lib/sla.js";

// Downtime dihitung oleh SQL (potong di batas rentang, incident berjalan
// dipotong di "sekarang"), jadi hanya bisa dipercaya bila dijalankan di Postgres.

const JAN = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-02-01T00:00:00Z") };
const JAN_SECONDS = 31 * 86400;

beforeEach(resetDb);
after(() => prisma.$disconnect());

const rowOf = async (range, monitorId, opts = {}) => (await slaReport({ ...range, monitorId, ...opts })).rows[0];

test("incident di dalam rentang dihitung penuh, beserta MTTR", async () => {
  const m = await createMonitor();
  await prisma.incident.createMany({
    data: [
      { monitor_id: m.id, started_at: new Date("2026-01-10T00:00:00Z"), resolved_at: new Date("2026-01-10T01:00:00Z") },
      { monitor_id: m.id, started_at: new Date("2026-01-20T00:00:00Z"), resolved_at: new Date("2026-01-20T00:30:00Z") },
    ],
  });
  const r = await rowOf(JAN, m.id);
  assert.equal(r.total_seconds, JAN_SECONDS);
  assert.equal(r.down_seconds, 5400);
  assert.equal(r.incidents, 2);
  assert.equal(r.mttr_seconds, 2700);
  assert.equal(r.longest_incident_seconds, 3600);
  assert.equal(r.uptime, Math.round(((JAN_SECONDS - 5400) / JAN_SECONDS) * 100 * 10000) / 10000);
});

test("incident yang melintasi batas rentang dipotong di batasnya", async () => {
  const m = await createMonitor();
  await prisma.incident.createMany({
    data: [
      { monitor_id: m.id, started_at: new Date("2025-12-31T23:00:00Z"), resolved_at: new Date("2026-01-01T01:00:00Z") },
      { monitor_id: m.id, started_at: new Date("2026-01-31T23:30:00Z"), resolved_at: new Date("2026-02-01T02:00:00Z") },
      // Di luar rentang sama sekali
      { monitor_id: m.id, started_at: new Date("2026-02-05T00:00:00Z"), resolved_at: new Date("2026-02-05T05:00:00Z") },
    ],
  });
  const r = await rowOf(JAN, m.id);
  assert.equal(r.down_seconds, 3600 + 1800);
  assert.equal(r.incidents, 2);
});

test("incident yang masih berjalan dihitung sampai sekarang", async () => {
  const now = Date.now();
  const m = await createMonitor({ created_at: minutesAgo(48 * 60, now) });
  await prisma.incident.create({ data: { monitor_id: m.id, started_at: minutesAgo(60, now) } });
  const r = await rowOf({ from: minutesAgo(24 * 60, now), to: new Date(now + 86400_000) }, m.id);
  assert.equal(r.ongoing_incidents, 1);
  assert.ok(Math.abs(r.down_seconds - 3600) <= 5, `down_seconds ${r.down_seconds}`);
  assert.equal(r.mttr_seconds, null);
});

test("incident saat maintenance dikecualikan sesuai pilihan", async () => {
  const m = await createMonitor();
  await prisma.incident.create({
    data: { monitor_id: m.id, maintenance: true, started_at: new Date("2026-01-10T00:00:00Z"), resolved_at: new Date("2026-01-10T01:00:00Z") },
  });
  assert.equal((await rowOf(JAN, m.id, { excludeMaintenance: true })).down_seconds, 0);
  assert.equal((await rowOf(JAN, m.id, { excludeMaintenance: false })).down_seconds, 3600);
});

test("monitor yang lahir di tengah rentang diukur sejak dibuat", async () => {
  const m = await createMonitor({ created_at: new Date("2026-01-31T00:00:00Z") });
  const r = await rowOf(JAN, m.id);
  assert.equal(r.total_seconds, 86400);
  assert.equal(r.uptime, 100);
});

test("monitor yang dibuat setelah rentang tidak masuk laporan", async () => {
  await createMonitor({ created_at: new Date("2026-03-01T00:00:00Z") });
  const { rows, summary } = await slaReport(JAN);
  assert.equal(rows.length, 0);
  assert.equal(summary.uptime, null);
});

test("error budget: terpakai, sisa, dan target terlewat", async () => {
  const ok = await createMonitor({ name: "a", slo_target: 99 });
  const bad = await createMonitor({ name: "b", slo_target: 99.99 });
  for (const id of [ok.id, bad.id]) {
    await prisma.incident.create({
      data: { monitor_id: id, started_at: new Date("2026-01-10T00:00:00Z"), resolved_at: new Date("2026-01-10T01:00:00Z") },
    });
  }
  const { rows, summary } = await slaReport(JAN);
  const [a, b] = rows;
  assert.equal(a.error_budget.allowed_seconds, Math.round(0.01 * JAN_SECONDS));
  assert.equal(a.error_budget.remaining_seconds, a.error_budget.allowed_seconds - 3600);
  assert.equal(a.error_budget.met, true);
  assert.equal(b.error_budget.met, false);
  assert.ok(b.error_budget.used_percent > 100);
  assert.equal(summary.with_target, 2);
  assert.equal(summary.meeting_target, 1);
  assert.equal(summary.breaching_target, 1);
  assert.equal(summary.total_down_seconds, 7200);
});
