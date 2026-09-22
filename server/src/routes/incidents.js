import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";

// Kabar manual yang ditulis admin selama incident berlangsung. Murni untuk
// komunikasi ke pengguna — status incident sendiri tetap ditentukan heartbeat,
// bukan oleh update ini.
export const incidentsRouter = Router();
incidentsRouter.use(requireAuth);

export const UPDATE_STATUSES = ["investigating", "identified", "monitoring", "resolved"];

const withMonitor = { monitor: { select: { id: true, name: true } } };

// Daftar incident untuk memilih di UI: ?open=true hanya yang belum selesai
incidentsRouter.get("/", async (req, res) => {
  const where = {};
  if (String(req.query.open || "") === "true") where.resolved_at = null;
  if (req.query.monitor_id) where.monitor_id = Number(req.query.monitor_id);
  const rows = await prisma.incident.findMany({
    where,
    include: { ...withMonitor, updates: { orderBy: { created_at: "desc" } } },
    orderBy: { started_at: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 50)),
  });
  res.json(rows);
});

incidentsRouter.get("/:id/updates", async (req, res) => {
  res.json(
    await prisma.incidentUpdate.findMany({
      where: { incident_id: Number(req.params.id) },
      orderBy: { created_at: "desc" },
    })
  );
});

incidentsRouter.post("/:id/updates", requireAdmin, async (req, res) => {
  const incidentId = Number(req.params.id);
  const incident = await prisma.incident.findUnique({ where: { id: incidentId }, select: { id: true } });
  if (!incident) return res.status(404).json({ error: "Incident tidak ditemukan" });

  const status = UPDATE_STATUSES.includes(req.body?.status) ? req.body.status : "investigating";
  const message = String(req.body?.message || "").trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: "Pesan update wajib diisi" });

  const update = await prisma.incidentUpdate.create({
    data: { incident_id: incidentId, status, message, author: req.user?.username || null },
  });
  res.status(201).json(update);
});

incidentsRouter.put("/:id/updates/:updateId", requireAdmin, async (req, res) => {
  const id = Number(req.params.updateId);
  const existing = await prisma.incidentUpdate.findUnique({ where: { id } });
  if (!existing || existing.incident_id !== Number(req.params.id)) {
    return res.status(404).json({ error: "Update tidak ditemukan" });
  }
  const data = {};
  if (req.body?.status !== undefined) {
    if (!UPDATE_STATUSES.includes(req.body.status)) return res.status(400).json({ error: "Status update tidak dikenal" });
    data.status = req.body.status;
  }
  if (req.body?.message !== undefined) {
    const message = String(req.body.message).trim().slice(0, 2000);
    if (!message) return res.status(400).json({ error: "Pesan update wajib diisi" });
    data.message = message;
  }
  res.json(await prisma.incidentUpdate.update({ where: { id }, data }));
});

incidentsRouter.delete("/:id/updates/:updateId", requireAdmin, async (req, res) => {
  await prisma.incidentUpdate
    .deleteMany({ where: { id: Number(req.params.updateId), incident_id: Number(req.params.id) } })
    .catch(() => {});
  res.json({ ok: true });
});
