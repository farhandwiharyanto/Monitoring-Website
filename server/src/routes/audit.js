import { Router } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireAdmin, denyApiKey } from "../lib/auth.js";

// Audit log hanya bisa dibaca, tidak ada endpoint untuk mengubah atau menghapus
// satu baris — jejaknya jadi tidak bisa dirapikan dari dalam aplikasi.
// Admin yang login saja: isinya menyebut siapa melakukan apa dari IP mana, dan
// sebuah API key tidak perlu bisa membaca jejak pemilik instance.
export const auditRouter = Router();
auditRouter.use(requireAuth, denyApiKey, requireAdmin);

// Filter dibangun dari query string; semuanya opsional dan bisa digabung.
// Diekspor supaya endpoint ekspor menyaring dengan aturan yang persis sama —
// apa yang terlihat di layar itulah yang terunduh.
export function buildAuditWhere(query) {
  const where = {};
  if (query.entity) where.entity = String(query.entity).slice(0, 40);
  if (query.action) where.action = String(query.action).slice(0, 60);
  if (query.actor) where.actor = { contains: String(query.actor).slice(0, 80), mode: "insensitive" };
  if (query.entity_id) where.entity_id = Number(query.entity_id);

  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;
  const range = {};
  if (from && !Number.isNaN(from.getTime())) range.gte = from;
  // Tanggal tanpa jam berarti "sampai akhir hari itu"
  if (to && !Number.isNaN(to.getTime())) {
    range.lte = /T/.test(String(query.to)) ? to : new Date(to.getTime() + 86400_000 - 1);
  }
  if (Object.keys(range).length) where.created_at = range;

  // Pencarian bebas pada ringkasan & nama entitas
  if (query.q) {
    const q = String(query.q).slice(0, 120);
    where.OR = [
      { summary: { contains: q, mode: "insensitive" } },
      { entity_name: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

auditRouter.get("/", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const skip = Math.max(0, Number(req.query.offset) || 0);
  const where = buildAuditWhere(req.query);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { created_at: "desc" }, take, skip }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ rows, total, limit: take, offset: skip });
});

// Nilai yang benar-benar ada di data, untuk mengisi dropdown filter tanpa menebak
auditRouter.get("/filters", async (req, res) => {
  const [actions, entities, actors] = await Promise.all([
    prisma.auditLog.groupBy({ by: ["action"], _count: { action: true }, orderBy: { action: "asc" } }),
    prisma.auditLog.groupBy({ by: ["entity"], _count: { entity: true }, orderBy: { entity: "asc" } }),
    prisma.auditLog.groupBy({ by: ["actor"], _count: { actor: true }, orderBy: { actor: "asc" }, take: 100 }),
  ]);
  res.json({
    actions: actions.map((a) => ({ value: a.action, count: a._count.action })),
    entities: entities.map((e) => ({ value: e.entity, count: e._count.entity })),
    actors: actors.map((a) => ({ value: a.actor, count: a._count.actor })),
    // Dipakai UI untuk memberi tahu berapa lama jejaknya disimpan
    retention_days: config.auditRetentionDays,
  });
});

// Jejak satu entitas, mis. semua perubahan pada monitor #3
auditRouter.get("/:entity/:id", async (req, res) => {
  const rows = await prisma.auditLog.findMany({
    where: { entity: String(req.params.entity).slice(0, 40), entity_id: Number(req.params.id) },
    orderBy: { created_at: "desc" },
    take: Math.min(200, Math.max(1, Number(req.query.limit) || 50)),
  });
  res.json(rows);
});
