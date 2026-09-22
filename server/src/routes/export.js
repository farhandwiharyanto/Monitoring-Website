import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, monitorInclude } from "../lib/stats.js";
import { STATUS_LABEL } from "../lib/status.js";

export const exportRouter = Router();
exportRouter.use(requireAuth);

// --- CSV ---
const cell = (v) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (columns, rows) =>
  // BOM agar Excel membaca UTF-8 dengan benar
  "﻿" + [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n");

function send(res, { format, filename, columns, rows }) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename}-${stamp}.csv"`);
    return res.send(toCsv(columns, rows));
  }
  res.set("Content-Disposition", `attachment; filename="${filename}-${stamp}.json"`);
  res.json(rows);
}

const fmt = (req) => (String(req.query.format || "csv").toLowerCase() === "json" ? "json" : "csv");

// Daftar monitor beserta status & uptime terkini
exportRouter.get("/monitors", async (req, res) => {
  const raw = await prisma.monitor.findMany({ include: monitorInclude, orderBy: { name: "asc" } });
  const decorated = await decorateMonitors(raw, { beats: 1 });
  const rows = decorated.map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    target: m.url || (m.port ? `${m.hostname}:${m.port}` : m.hostname) || "",
    status: STATUS_LABEL[m.underlying_status] ?? "",
    active: m.active,
    in_maintenance: m.in_maintenance,
    interval_seconds: m.interval_seconds,
    uptime_24h: m.uptime_24h,
    uptime_30d: m.uptime_30d,
    avg_response_24h: m.avg_response_24h,
    last_response_time: m.last_response_time,
    last_check: m.last_check,
    cert_expires_at: m.cert_expires_at,
    cert_issuer: m.cert_issuer,
    tags: (m.tags || []).map((t) => t.name).join(" "),
  }));
  send(res, {
    format: fmt(req),
    filename: "pulsewatch-monitors",
    columns: ["id", "name", "type", "target", "status", "active", "in_maintenance", "interval_seconds", "uptime_24h", "uptime_30d", "avg_response_24h", "last_response_time", "last_check", "cert_expires_at", "cert_issuer", "tags"],
    rows,
  });
});

// Riwayat heartbeat: ?monitor_id=..&hours=24 (maksimal 90 hari / 200rb baris)
exportRouter.get("/heartbeats", async (req, res) => {
  const hours = Math.min(24 * 90, Math.max(1, Number(req.query.hours) || 24));
  const where = { created_at: { gte: new Date(Date.now() - hours * 3600_000) } };
  if (req.query.monitor_id) where.monitor_id = Number(req.query.monitor_id);
  const beats = await prisma.heartbeat.findMany({
    where,
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    take: 200_000,
    include: { monitor: { select: { name: true } } },
  });
  const rows = beats.map((b) => ({
    monitor_id: b.monitor_id,
    monitor: b.monitor.name,
    status: STATUS_LABEL[b.status] ?? b.status,
    response_time: b.response_time,
    maintenance: b.maintenance,
    important: b.important,
    message: b.message,
    created_at: b.created_at,
  }));
  send(res, {
    format: fmt(req),
    filename: "pulsewatch-heartbeats",
    columns: ["monitor_id", "monitor", "status", "response_time", "maintenance", "important", "message", "created_at"],
    rows,
  });
});

// Riwayat incident + durasinya
exportRouter.get("/incidents", async (req, res) => {
  const where = req.query.monitor_id ? { monitor_id: Number(req.query.monitor_id) } : {};
  const incidents = await prisma.incident.findMany({
    where,
    orderBy: { started_at: "desc" },
    take: 50_000,
    include: { monitor: { select: { name: true } } },
  });
  const rows = incidents.map((i) => ({
    id: i.id,
    monitor_id: i.monitor_id,
    monitor: i.monitor.name,
    started_at: i.started_at,
    resolved_at: i.resolved_at,
    duration_seconds: Math.round(((i.resolved_at ? new Date(i.resolved_at) : new Date()) - new Date(i.started_at)) / 1000),
    ongoing: !i.resolved_at,
    maintenance: i.maintenance,
    cause: i.cause,
  }));
  send(res, {
    format: fmt(req),
    filename: "pulsewatch-incidents",
    columns: ["id", "monitor_id", "monitor", "started_at", "resolved_at", "duration_seconds", "ongoing", "maintenance", "cause"],
    rows,
  });
});

// Backup konfigurasi (tanpa data heartbeat). Kredensial notifikasi TIDAK diekspor.
exportRouter.get("/config", requireAdmin, async (req, res) => {
  const [monitors, tags, statusPages, maintenance, notifications] = await Promise.all([
    prisma.monitor.findMany({ include: { tags: { include: { tag: true } }, notifications: true }, orderBy: { id: "asc" } }),
    prisma.tag.findMany({ orderBy: { id: "asc" } }),
    prisma.statusPage.findMany({ include: { monitors: { orderBy: { sort_order: "asc" } } }, orderBy: { id: "asc" } }),
    prisma.maintenanceWindow.findMany({ orderBy: { id: "asc" } }),
    prisma.notification.findMany({ orderBy: { id: "asc" } }),
  ]);
  const payload = {
    exported_at: new Date().toISOString(),
    version: 2,
    note: "Konfigurasi notifikasi sengaja tidak diekspor (berisi token/kredensial).",
    monitors: monitors.map(({ tags: t, notifications: n, push_token, ...m }) => ({
      ...m,
      // push_token adalah kredensial — jangan ikut dalam backup yang bisa dibagikan
      has_push_token: !!push_token,
      tags: t.map((x) => x.tag.name),
      notification_ids: n.map((x) => x.notification_id),
    })),
    tags,
    status_pages: statusPages.map(({ monitors: sm, ...p }) => ({ ...p, monitor_ids: sm.map((x) => x.monitor_id) })),
    maintenance_windows: maintenance,
    notifications: notifications.map(({ config, ...n }) => ({ ...n, config: "<redacted>" })),
  };
  res.set("Content-Disposition", `attachment; filename="pulsewatch-config-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(payload);
});
