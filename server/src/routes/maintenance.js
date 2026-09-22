import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateWindow } from "../lib/maintenance.js";

export const maintenanceRouter = Router();
maintenanceRouter.use(requireAuth);

const RECUR = ["none", "daily", "weekly"];

function validate(body) {
  const start = new Date(body.start_at);
  const end = new Date(body.end_at);
  const errors = [];
  if (!body.title?.trim()) errors.push("Judul wajib diisi");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) errors.push("Waktu mulai/selesai tidak valid");
  else if (end <= start) errors.push("Waktu selesai harus setelah mulai");
  const recurring = RECUR.includes(body.recurring) ? body.recurring : "none";
  const days = Array.isArray(body.days_of_week) ? body.days_of_week.map(Number).filter((d) => d >= 0 && d <= 6).join(",") : body.days_of_week || null;
  return {
    errors,
    data: {
      monitor_id: Number(body.monitor_id),
      title: String(body.title || "").trim(),
      start_at: start, end_at: end, recurring,
      days_of_week: recurring === "weekly" ? days : null,
      active: body.active === undefined ? true : !!body.active,
    },
  };
}

const withMonitor = { monitor: { select: { id: true, name: true } } };

maintenanceRouter.get("/", async (req, res) => {
  const where = req.query.monitor_id ? { monitor_id: Number(req.query.monitor_id) } : {};
  const rows = await prisma.maintenanceWindow.findMany({ where, include: withMonitor, orderBy: [{ active: "desc" }, { start_at: "desc" }] });
  res.json(rows.map(decorateWindow));
});

maintenanceRouter.post("/", requireAdmin, async (req, res) => {
  const { errors, data } = validate(req.body || {});
  if (!(await prisma.monitor.findUnique({ where: { id: data.monitor_id || 0 } }))) errors.push("Monitor tidak ditemukan");
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  res.status(201).json(decorateWindow(await prisma.maintenanceWindow.create({ data, include: withMonitor })));
});

maintenanceRouter.put("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.maintenanceWindow.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Maintenance window tidak ditemukan" });
  const { errors, data } = validate({ ...existing, ...req.body });
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  res.json(decorateWindow(await prisma.maintenanceWindow.update({ where: { id }, data, include: withMonitor })));
});

maintenanceRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.maintenanceWindow.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.json({ ok: true });
});
