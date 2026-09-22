import { Router } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, findMonitor, dashboardStats, monitorInclude } from "../lib/stats.js";
import { scheduleNow, unschedule, checkCertificateNow } from "../scheduler.js";
import { runCheck, MONITOR_TYPES } from "../checks/index.js";
import { newPushToken } from "./push.js";
import { upsertTags } from "./tags.js";

export const monitorsRouter = Router();
monitorsRouter.use(requireAuth);

const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "SRV"];
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

// push_token adalah kredensial: hanya admin yang boleh melihatnya, dan selalu
// dikirim bersama URL siap pakai supaya gampang disalin.
function shape(monitor, user) {
  if (!monitor) return monitor;
  const { push_token, ...rest } = monitor;
  if (monitor.type !== "push") return rest;
  if (user?.role !== "admin") return { ...rest, push_url: null };
  return { ...rest, push_token, push_url: push_token ? `${config.baseUrl}/api/push/${push_token}` : null };
}

function validate(body) {
  const errors = [];
  const type = MONITOR_TYPES.includes(body.type) ? body.type : "http";
  const m = {
    name: String(body.name || "").trim().slice(0, 120),
    type,
    url: body.url ? String(body.url).trim().slice(0, 2048) : null,
    hostname: body.hostname ? String(body.hostname).trim().slice(0, 253) : null,
    port: body.port ? Number(body.port) : null,
    dns_resolve_type: DNS_TYPES.includes(String(body.dns_resolve_type || "").toUpperCase()) ? String(body.dns_resolve_type).toUpperCase() : "A",
    dns_expected: body.dns_expected ? String(body.dns_expected).slice(0, 255) : null,
    method: HTTP_METHODS.includes(String(body.method || "").toUpperCase()) ? String(body.method).toUpperCase() : "GET",
    interval_seconds: Math.min(86400, Math.max(10, Number(body.interval_seconds) || 60)),
    timeout_seconds: Math.min(300, Math.max(1, Number(body.timeout_seconds) || 30)),
    max_retries: Math.min(10, Math.max(0, Number(body.max_retries) || 0)),
    expected_status_codes: String(body.expected_status_codes || "200-299").slice(0, 100),
    keyword: body.keyword ? String(body.keyword).slice(0, 255) : null,
    active: body.active === undefined ? true : !!body.active,
    push_grace_seconds: Math.min(86400, Math.max(0, Number(body.push_grace_seconds ?? 60))),
    check_cert: body.check_cert === undefined ? true : !!body.check_cert,
  };

  if (!m.name) errors.push("Nama wajib diisi");
  // Monitor push tidak melakukan koneksi keluar, jadi timeout-nya tidak dipakai
  if (m.type !== "push" && m.timeout_seconds > m.interval_seconds) {
    errors.push("Timeout tidak boleh lebih besar dari interval");
  }

  if (m.type === "http") {
    let parsed;
    try { parsed = new URL(m.url || ""); } catch { parsed = null; }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) errors.push("URL harus diawali http:// atau https://");
    if (!/^\s*(\d{3}(\s*-\s*\d{3})?)(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/.test(m.expected_status_codes)) {
      errors.push("Format status code tidak valid (contoh: 200-299 atau 200,301)");
    }
  } else if (m.type === "push") {
    // Tidak butuh target: heartbeat datang dari luar
  } else if (!m.hostname) {
    errors.push("Hostname wajib diisi");
  }
  if (m.type === "tcp" && !(m.port > 0 && m.port < 65536)) errors.push("Port tidak valid");

  return { m, errors };
}

// Relasi notifikasi & tag: hanya disentuh kalau field dikirim (null = biarkan)
async function syncRelations(monitorId, body) {
  if (Array.isArray(body.notification_ids)) {
    const valid = await prisma.notification.findMany({
      where: { id: { in: body.notification_ids.map(Number).filter(Number.isFinite) } },
      select: { id: true },
    });
    await prisma.monitorNotification.deleteMany({ where: { monitor_id: monitorId } });
    await prisma.monitorNotification.createMany({
      data: valid.map((n) => ({ monitor_id: monitorId, notification_id: n.id })),
      skipDuplicates: true,
    });
  }
  const tagIds = await upsertTags(body.tags);
  if (tagIds) {
    await prisma.monitorTag.deleteMany({ where: { monitor_id: monitorId } });
    await prisma.monitorTag.createMany({ data: tagIds.map((tag_id) => ({ monitor_id: monitorId, tag_id })), skipDuplicates: true });
  }
}

// GET /api/monitors?tag=nama  → list (opsional filter tag)
monitorsRouter.get("/", async (req, res) => {
  const where = req.query.tag ? { tags: { some: { tag: { name: String(req.query.tag) } } } } : {};
  const rows = await prisma.monitor.findMany({ where, include: monitorInclude, orderBy: { name: "asc" } });
  res.json((await decorateMonitors(rows)).map((m) => shape(m, req.user)));
});

monitorsRouter.get("/stats", async (req, res) => res.json(await dashboardStats()));

monitorsRouter.post("/", requireAdmin, async (req, res) => {
  const { m, errors } = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  // Monitor push langsung diberi token; tipe lain tidak memerlukannya
  const created = await prisma.monitor.create({ data: { ...m, push_token: m.type === "push" ? newPushToken() : null } });
  await syncRelations(created.id, req.body);
  scheduleNow(created.id);
  res.status(201).json(shape(await findMonitor(created.id), req.user));
});

// Uji check sekali tanpa menyimpan (dipakai form "Test")
monitorsRouter.post("/test", requireAdmin, async (req, res) => {
  const { m, errors } = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  res.json(await runCheck(m));
});

monitorsRouter.get("/:id", async (req, res) => {
  const m = await findMonitor(req.params.id, { beats: 50 });
  if (!m) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  res.json(shape(m, req.user));
});

monitorsRouter.put("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.monitor.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  const { m, errors } = validate({ ...existing, ...req.body });
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  // Berganti tipe ke/dari push: token dibuat saat dibutuhkan, dibuang saat tidak
  const data = { ...m };
  if (m.type === "push" && !existing.push_token) data.push_token = newPushToken();
  if (m.type !== "push" && existing.push_token) data.push_token = null;
  await prisma.monitor.update({ where: { id }, data });
  await syncRelations(id, req.body);
  m.active ? scheduleNow(id) : unschedule(id);
  res.json(shape(await findMonitor(id), req.user));
});

monitorsRouter.post("/:id/pause", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.update({ where: { id }, data: { active: false } });
  unschedule(id);
  res.json(shape(await findMonitor(id), req.user));
});
monitorsRouter.post("/:id/resume", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.update({ where: { id }, data: { active: true } });
  scheduleNow(id);
  res.json(shape(await findMonitor(id), req.user));
});

// Token push bocor → buat ulang; URL lama langsung tidak berlaku
monitorsRouter.post("/:id/reset-push-token", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const monitor = await prisma.monitor.findUnique({ where: { id } });
  if (!monitor) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  if (monitor.type !== "push") return res.status(400).json({ error: "Hanya untuk monitor tipe push" });
  await prisma.monitor.update({ where: { id }, data: { push_token: newPushToken() } });
  scheduleNow(id);
  res.json(shape(await findMonitor(id), req.user));
});

// Periksa sertifikat TLS sekarang juga (di luar jadwal 6 jam)
monitorsRouter.post("/:id/cert", requireAdmin, async (req, res) => {
  const monitor = await prisma.monitor.findUnique({ where: { id: Number(req.params.id) } });
  if (!monitor) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  const info = await checkCertificateNow(monitor);
  if (!info.ok) return res.status(400).json({ error: info.error });
  res.json(info);
});

monitorsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.delete({ where: { id } }).catch(() => {});
  unschedule(id);
  res.json({ ok: true });
});

// Heartbeat history untuk grafik: ?hours=24
monitorsRouter.get("/:id/heartbeats", async (req, res) => {
  const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
  const rows = await prisma.heartbeat.findMany({
    where: { monitor_id: Number(req.params.id), created_at: { gte: new Date(Date.now() - hours * 3600_000) } },
    orderBy: { created_at: "asc" },
    select: { id: true, status: true, message: true, response_time: true, important: true, maintenance: true, created_at: true },
  });
  res.json(rows);
});

monitorsRouter.get("/:id/incidents", async (req, res) => {
  res.json(await prisma.incident.findMany({ where: { monitor_id: Number(req.params.id) }, orderBy: { started_at: "desc" }, take: 100 }));
});

// Event penting (perubahan status) untuk list "Important events"
monitorsRouter.get("/:id/events", async (req, res) => {
  res.json(
    await prisma.heartbeat.findMany({ where: { monitor_id: Number(req.params.id), important: true }, orderBy: { created_at: "desc" }, take: 50 })
  );
});

// Maintenance window milik monitor ini
monitorsRouter.get("/:id/maintenance", async (req, res) => {
  const { decorateWindow } = await import("../lib/maintenance.js");
  const rows = await prisma.maintenanceWindow.findMany({ where: { monitor_id: Number(req.params.id) }, orderBy: [{ active: "desc" }, { start_at: "desc" }] });
  res.json(rows.map(decorateWindow));
});
