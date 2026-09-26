import test from "node:test";
import assert from "node:assert/strict";
import { prisma, resetDb, createMonitor } from "./helpers.js";
import { pruneOldDbMetrics } from "../src/db.js";
import { config } from "../src/config.js";

test("metrik tersimpan sebagai JSON dan yang melewati retensi dibersihkan", async () => {
  await resetDb();
  const m = await createMonitor({ type: "postgres" });
  const old = new Date(Date.now() - (config.dbMetricsRetentionDays + 1) * 86400_000);
  await prisma.dbMetric.createMany({
    data: [
      { monitor_id: m.id, created_at: old, metrics: { conn_used: 1 } },
      { monitor_id: m.id, metrics: { conn_used: 2, version: null } },
    ],
  });
  await pruneOldDbMetrics();
  const rows = await prisma.dbMetric.findMany();
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].metrics, { conn_used: 2, version: null });

  // Menghapus monitor ikut menghapus metriknya
  await prisma.monitor.delete({ where: { id: m.id } });
  assert.equal(await prisma.dbMetric.count(), 0);
});
