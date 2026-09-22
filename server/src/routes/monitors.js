import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, findMonitor, dashboardStats, monitorInclude } from "../lib/stats.js";
import { scheduleNow, unschedule } from "../scheduler.js";
import { runCheck } from "../checks/index.js";
import { upsertTags } from "./tags.js";

export const monitorsRouter = Router();
monitorsRouter.use(requireAuth);

const TYPES = ["http", "tcp", "ping", "dns"];

function validate(body) {
  const errors = [];
  const m = {
    name: String(body.name || "").trim(),
    type: TYPES.includes(body.type) ? body.type : "http",
    url: body.url ? String(body.url).trim() : null,
    hostname: body.hostname ? String(body.hostname).trim() : null,
    port: body.port ? Number(body.port) : null,
    dns_resolve_type: body.dns_resolve_type || "A",
    dns_expected: body.dns_expected || null,
    method: (body.method || "GET").toUpperCase(),
    interval_seconds: Math.max(10, Number(body.interval_seconds) || 60),
    timeout_seconds: Math.max(1, Number(body.timeout_seconds) || 30),
    max_retries: Math.max(0, Number(body.max_retries) || 0),
    expected_status_codes: body.expected_status_codes || "200-299",
    keyword: body.keyword || null,
    active: body.active === undefined ? true : !!body.active,
  };
  if (!m.name) errors.push("Nama wajib diisi");
  if (m.type === "http" && !/^https?:\/\//i.test(m.url || "")) errors.push("URL harus diawali http:// atau https://");
  if (m.type !== "http" && !m.hostname) errors.push("Hostname wajib diisi");
  if (m.type === "tcp" && !(m.port > 0 && m.port < 65536)) errors.push("Port tidak valid");
  return { m, errors };
}

// Relasi notifikasi & tag: hanya disentuh kalau field dikirim (null = biarkan)
async function syncRelations(monitorId, body) {
  if (Array.isArray(body.notification_ids)) {
    await prisma.monitorNotification.deleteMany({ where: { monitor_id: monitorId } });
    await prisma.monitorNotification.createMany({
      data: body.notification_ids.map((id) => ({ monitor_id: monitorId, notification_id: Number(id) })),
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
  res.json(await decorateMonitors(rows));
});

monitorsRouter.get("/stats", async (req, res) => res.json(await dashboardStats()));

monitorsRouter.post("/", requireAdmin, async (req, res) => {
  const { m, errors } = validate(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  const created = await prisma.monitor.create({ data: m });
  await syncRelations(created.id, req.body);
  scheduleNow(created.id);
  res.status(201).json(await findMonitor(created.id));
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
  res.json(m);
});

monitorsRouter.put("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.monitor.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  const { m, errors } = validate({ ...existing, ...req.body });
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  await prisma.monitor.update({ where: { id }, data: m });
  await syncRelations(id, req.body);
  m.active ? scheduleNow(id) : unschedule(id);
  res.json(await findMonitor(id));
});

monitorsRouter.post("/:id/pause", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.update({ where: { id }, data: { active: false } });
  unschedule(id);
  res.json(await findMonitor(id));
});
monitorsRouter.post("/:id/resume", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.update({ where: { id }, data: { active: true } });
  scheduleNow(id);
  res.json(await findMonitor(id));
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
