import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { lastStatusMap } from "../lib/dependency.js";
import { METRIC_TYPES, toSeries, downsample, findings } from "../lib/dbMetrics.js";

// Analitik monitor database (menu Database). Dibaca siapa pun yang login,
// sama seperti laporan: isinya angka, bukan kredensial atau konfigurasi.
export const dbAnalyticsRouter = Router();
dbAnalyticsRouter.use(requireAuth);

const RANGES = { "24h": 1, "7d": 7, "30d": 30 };

const monitorFields = { id: true, name: true, type: true, active: true };

// Sampel tertua dalam 7 hari terakhir per monitor, pembanding pertumbuhan ukuran.
// created_at tanpa zona berisi UTC, jadi batasnya disamakan (lihat rencana.md).
async function weekAgoMap(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const since = new Date(Date.now() - 7 * 86400_000);
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT ON (monitor_id) monitor_id, metrics FROM db_metrics
    WHERE monitor_id IN (${Prisma.join(ids)}) AND created_at >= ${since}::timestamptz AT TIME ZONE 'UTC'
    ORDER BY monitor_id, created_at ASC`;
  for (const r of rows) map.set(r.monitor_id, r.metrics);
  return map;
}

// Ringkasan semua monitor database: metrik terbaru dan QPS dari dua sampel terakhir
dbAnalyticsRouter.get("/", async (req, res) => {
  const monitors = await prisma.monitor.findMany({
    where: { type: { in: METRIC_TYPES } },
    select: monitorFields,
    orderBy: { name: "asc" },
  });
  const ids = monitors.map((m) => m.id);
  const [statuses, weekAgo, rows] = await Promise.all([
    lastStatusMap(ids),
    weekAgoMap(ids),
    ids.length
      ? prisma.$queryRaw`
          SELECT monitor_id, created_at, metrics FROM (
            SELECT monitor_id, created_at, metrics,
                   row_number() OVER (PARTITION BY monitor_id ORDER BY created_at DESC, id DESC) AS rn
            FROM db_metrics WHERE monitor_id IN (${Prisma.join(ids)})
          ) t WHERE rn <= 2 ORDER BY monitor_id, created_at`
      : [],
  ]);
  const byMonitor = new Map();
  for (const r of rows) byMonitor.set(r.monitor_id, [...(byMonitor.get(r.monitor_id) || []), r]);

  res.json(
    monitors.map((m) => {
      const samples = byMonitor.get(m.id) || [];
      const series = toSeries(samples);
      const latest = samples.at(-1);
      return {
        ...m,
        status: statuses.get(m.id) ?? null,
        collected_at: latest?.created_at ?? null,
        metrics: latest?.metrics ?? null,
        point: series.at(-1) ?? null,
        findings: findings(latest?.metrics, weekAgo.get(m.id)),
      };
    })
  );
});

// Deret waktu satu monitor untuk grafik (?range=24h|7d|30d)
dbAnalyticsRouter.get("/:monitorId", async (req, res) => {
  const id = Number(req.params.monitorId);
  const range = req.query.range || "24h";
  if (!RANGES[range]) return res.status(400).json({ error: "range harus 24h, 7d, atau 30d" });
  const monitor = Number.isInteger(id)
    ? await prisma.monitor.findFirst({ where: { id, type: { in: METRIC_TYPES } }, select: monitorFields })
    : null;
  if (!monitor) return res.status(404).json({ error: "Monitor database tidak ditemukan" });

  const since = new Date(Date.now() - RANGES[range] * 86400_000);
  const samples = await prisma.dbMetric.findMany({
    where: { monitor_id: id, created_at: { gte: since } },
    orderBy: { created_at: "asc" },
    select: { created_at: true, metrics: true },
  });
  const latest = samples.at(-1);
  const [statuses, weekAgo] = await Promise.all([lastStatusMap([id]), weekAgoMap([id])]);
  res.json({
    monitor: { ...monitor, status: statuses.get(id) ?? null },
    range,
    collected_at: latest?.created_at ?? null,
    metrics: latest?.metrics ?? null,
    findings: findings(latest?.metrics, weekAgo.get(id)),
    series: downsample(toSeries(samples)),
  });
});
