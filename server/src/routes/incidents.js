import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { recordAudit, diffFields } from "../lib/audit.js";
import { escalationMap } from "../lib/escalation.js";

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
  // Nama monitor induk yang menahan alert, supaya UI bisa menyebutnya langsung
  const blockerIds = [...new Set(rows.map((r) => r.suppressed_by_id).filter(Boolean))];
  const names = new Map(
    (blockerIds.length
      ? await prisma.monitor.findMany({ where: { id: { in: blockerIds } }, select: { id: true, name: true } })
      : []
    ).map((m) => [m.id, m.name])
  );
  // Rantai eskalasi tiap incident: dipakai UI untuk menandai mana yang sudah
  // ditangani dan kapan tingkat berikutnya jatuh tempo.
  const escalations = await escalationMap(rows.map((r) => r.id));
  res.json(rows.map((r) => ({
    ...r,
    suppressed_by: r.suppressed_by_id ? { id: r.suppressed_by_id, name: names.get(r.suppressed_by_id) || null } : null,
    escalation: escalations.get(r.id) || null,
  })));
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
  recordAudit(req, {
    action: "incident_update.create", entity: "incident", entityId: incidentId,
    summary: `Kabar incident #${incidentId} ditulis (${status})`,
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
  const updated = await prisma.incidentUpdate.update({ where: { id }, data });
  recordAudit(req, {
    action: "incident_update.edit", entity: "incident", entityId: existing.incident_id,
    summary: `Kabar incident #${existing.incident_id} disunting`,
    changes: diffFields(existing, data),
  });
  res.json(updated);
});

incidentsRouter.delete("/:id/updates/:updateId", requireAdmin, async (req, res) => {
  const incidentId = Number(req.params.id);
  const { count } = await prisma.incidentUpdate
    .deleteMany({ where: { id: Number(req.params.updateId), incident_id: incidentId } })
    .catch(() => ({ count: 0 }));
  if (count) {
    recordAudit(req, {
      action: "incident_update.delete", entity: "incident", entityId: incidentId,
      summary: `Kabar incident #${incidentId} dihapus`,
    });
  }
  res.json({ ok: true });
});
