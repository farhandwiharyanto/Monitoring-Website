import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, monitorInclude } from "../lib/stats.js";
import { STATUS_LABEL } from "../lib/status.js";
import { config } from "../config.js";
import { buildAuditWhere } from "./audit.js";
import { slaReport, monthRange, parseMonth, humanDuration } from "../lib/sla.js";

export const exportRouter = Router();
exportRouter.use(requireAuth);

const clampDate = (v, fallback) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
};

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

// Export uptime & response time dalam rentang tanggal:
//   /api/export/csv?monitorId=3&from=2026-09-01&to=2026-09-23[&location=all]
// Disediakan terpisah dari /export/heartbeats karena memakai rentang from/to
// dan satu baris per heartbeat dengan kolom siap olah di spreadsheet.
exportRouter.get("/csv", async (req, res) => {
  const monitorId = Number(req.query.monitorId ?? req.query.monitor_id);
  const to = clampDate(req.query.to, new Date());
  const from = clampDate(req.query.from, new Date(to.getTime() - 7 * 86400_000));
  if (from > to) return res.status(400).json({ error: "Tanggal 'from' harus sebelum 'to'" });

  const where = { created_at: { gte: from, lte: to } };
  if (Number.isFinite(monitorId)) {
    where.monitor_id = monitorId;
    if (!(await prisma.monitor.findUnique({ where: { id: monitorId }, select: { id: true } }))) {
      return res.status(404).json({ error: "Monitor tidak ditemukan" });
    }
  }
  // Sama seperti /monitors/:id/heartbeats: default lokasi primary, "all" untuk semua.
  // Baris lama tanpa label lokasi dihitung milik primary.
  const location = req.query.location ? String(req.query.location) : config.primaryLocation;
  if (location !== "all") {
    if (location === config.primaryLocation) where.OR = [{ location }, { location: null }];
    else where.location = location;
  }

  const beats = await prisma.heartbeat.findMany({
    where,
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
    take: 200_000,
    include: { monitor: { select: { name: true } } },
  });

  const rows = beats.map((b) => ({
    monitor_id: b.monitor_id,
    monitor: b.monitor.name,
    location: b.location || config.primaryLocation,
    timestamp: b.created_at,
    status: STATUS_LABEL[b.status] ?? b.status,
    // Kolom 0/1 memudahkan hitung uptime langsung di spreadsheet;
    // heartbeat pending & maintenance sengaja dikosongkan agar tidak ikut dirata-rata.
    up: b.maintenance || b.status === 2 ? "" : b.status === 1 ? 1 : 0,
    response_time_ms: b.response_time,
    maintenance: b.maintenance,
    assertion_ok: b.assertion_ok === null ? "" : b.assertion_ok,
    message: b.message,
  }));

  send(res, {
    format: fmt(req),
    filename: `pulsewatch-uptime${Number.isFinite(monitorId) ? "-" + monitorId : ""}`,
    columns: ["monitor_id", "monitor", "location", "timestamp", "status", "up", "response_time_ms", "maintenance", "assertion_ok", "message"],
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
    location: b.location || config.primaryLocation,
    status: STATUS_LABEL[b.status] ?? b.status,
    response_time: b.response_time,
    maintenance: b.maintenance,
    important: b.important,
    assertion_ok: b.assertion_ok === null ? "" : b.assertion_ok,
    assertion_message: b.assertion_message,
    message: b.message,
    created_at: b.created_at,
  }));
  send(res, {
    format: fmt(req),
    filename: "pulsewatch-heartbeats",
    columns: ["monitor_id", "monitor", "location", "status", "response_time", "maintenance", "important", "assertion_ok", "assertion_message", "message", "created_at"],
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

// Laporan SLA satu rentang — untuk dilampirkan ke laporan bulanan ke klien.
// Durasi disertakan dua kali: dalam detik supaya bisa dihitung ulang, dan dalam
// bentuk terbaca supaya langsung enak dilihat di spreadsheet.
exportRouter.get("/sla", async (req, res) => {
  const range = (req.query.month && parseMonth(req.query.month)) || {
    from: clampDate(req.query.from, monthRange().from),
    to: clampDate(req.query.to, monthRange().to),
  };
  const { rows } = await slaReport({
    from: range.from, to: range.to,
    monitorId: req.query.monitor_id || null,
    excludeMaintenance: req.query.include_maintenance === "true" ? false : undefined,
  });

  send(res, {
    format: fmt(req),
    filename: "pulsewatch-sla",
    columns: [
      "monitor_id", "monitor", "type", "measured_from", "measured_to",
      "uptime_percent", "slo_target", "slo_met", "down_seconds", "downtime",
      "error_budget_seconds", "error_budget_used_seconds", "error_budget_remaining_seconds", "error_budget_used_percent",
      "incidents", "ongoing_incidents", "mttr_seconds", "longest_incident_seconds",
    ],
    rows: rows.map((r) => ({
      monitor_id: r.monitor_id,
      monitor: r.monitor,
      type: r.type,
      measured_from: r.measured_from,
      measured_to: r.measured_to,
      uptime_percent: r.uptime,
      slo_target: r.slo_target ?? "",
      slo_met: r.error_budget ? r.error_budget.met : "",
      down_seconds: r.down_seconds,
      downtime: humanDuration(r.down_seconds),
      error_budget_seconds: r.error_budget?.allowed_seconds ?? "",
      error_budget_used_seconds: r.error_budget?.used_seconds ?? "",
      error_budget_remaining_seconds: r.error_budget?.remaining_seconds ?? "",
      error_budget_used_percent: r.error_budget?.used_percent ?? "",
      incidents: r.incidents,
      ongoing_incidents: r.ongoing_incidents,
      mttr_seconds: r.mttr_seconds ?? "",
      longest_incident_seconds: r.longest_incident_seconds ?? "",
    })),
  });
});

// Audit log untuk arsip di luar aplikasi (mis. disimpan ke object storage).
// Admin-only, sejalan dengan endpoint /api/audit-logs.
exportRouter.get("/audit", requireAdmin, async (req, res) => {
  // Filter yang sama persis dengan /api/audit-logs, jadi hasil unduhan cocok
  // dengan yang sedang ditampilkan di layar.
  const where = buildAuditWhere(req.query);

  const rows = (await prisma.auditLog.findMany({ where, orderBy: { created_at: "desc" }, take: 50_000 })).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    actor: r.actor,
    actor_type: r.actor_type,
    action: r.action,
    entity: r.entity,
    entity_id: r.entity_id,
    entity_name: r.entity_name,
    summary: r.summary,
    ip: r.ip,
    // Kolom changes diratakan jadi satu sel supaya CSV tetap satu baris per kejadian
    changes: r.changes ? JSON.stringify(r.changes) : "",
  }));
  send(res, {
    format: fmt(req),
    filename: "pulsewatch-audit",
    columns: ["id", "created_at", "actor", "actor_type", "action", "entity", "entity_id", "entity_name", "summary", "ip", "changes"],
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
