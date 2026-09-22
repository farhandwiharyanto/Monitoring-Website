import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, monitorInclude } from "../lib/stats.js";

export const statusPagesRouter = Router();   // admin (butuh auth)
export const publicStatusRouter = Router();  // publik tanpa login

const include = { monitors: { select: { monitor_id: true }, orderBy: { sort_order: "asc" } } };
const shape = ({ monitors, ...p }) => ({ ...p, monitor_ids: monitors.map((m) => m.monitor_id) });

async function syncMonitors(pageId, ids) {
  if (!Array.isArray(ids)) return;
  await prisma.statusPageMonitor.deleteMany({ where: { status_page_id: pageId } });
  await prisma.statusPageMonitor.createMany({
    data: ids.map((id, i) => ({ status_page_id: pageId, monitor_id: Number(id), sort_order: i })),
    skipDuplicates: true,
  });
}

const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

statusPagesRouter.use(requireAuth);
statusPagesRouter.get("/", async (req, res) => {
  res.json((await prisma.statusPage.findMany({ include, orderBy: { title: "asc" } })).map(shape));
});
statusPagesRouter.post("/", requireAdmin, async (req, res) => {
  const { title, description, published, monitor_ids } = req.body || {};
  const slug = slugify(req.body.slug || title);
  if (!title || !slug) return res.status(400).json({ error: "Judul/slug wajib diisi" });
  if (await prisma.statusPage.findUnique({ where: { slug } })) return res.status(400).json({ error: "Slug sudah dipakai" });
  const page = await prisma.statusPage.create({ data: { slug, title, description: description || null, published: published !== false } });
  await syncMonitors(page.id, monitor_ids);
  res.status(201).json(shape(await prisma.statusPage.findUnique({ where: { id: page.id }, include })));
});
statusPagesRouter.put("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.statusPage.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Status page tidak ditemukan" });
  const { title, description, published, monitor_ids } = req.body || {};
  const slug = slugify(req.body.slug || title || existing.slug);
  const clash = await prisma.statusPage.findFirst({ where: { slug, NOT: { id } } });
  if (clash) return res.status(400).json({ error: "Slug sudah dipakai" });
  await prisma.statusPage.update({
    where: { id },
    data: { slug, title: title || existing.title, description: description ?? existing.description, published: published !== false },
  });
  await syncMonitors(id, monitor_ids);
  res.json(shape(await prisma.statusPage.findUnique({ where: { id }, include })));
});
statusPagesRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.statusPage.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.json({ ok: true });
});

// ---- Public ----
publicStatusRouter.get("/:slug", async (req, res) => {
  const page = await prisma.statusPage.findFirst({
    where: { slug: req.params.slug, published: true },
    include: { monitors: { orderBy: { sort_order: "asc" }, include: { monitor: { include: monitorInclude } } } },
  });
  if (!page) return res.status(404).json({ error: "Status page tidak ditemukan" });
  const decorated = await decorateMonitors(page.monitors.map((x) => x.monitor), { beats: 30 });
  const since = new Date(Date.now() - 7 * 86400_000);
  const incidents = await prisma.incident.findMany({
    where: { monitor_id: { in: decorated.map((d) => d.id) }, started_at: { gte: since } },
    orderBy: { started_at: "desc" },
    select: { monitor_id: true, started_at: true, resolved_at: true, maintenance: true },
  });
  // Hanya expose data yang aman untuk publik
  const monitors = decorated.map((d) => ({
    id: d.id, name: d.name, type: d.type, status: d.status, in_maintenance: d.in_maintenance,
    tags: d.tags,
    uptime_24h: d.uptime_24h, uptime_30d: d.uptime_30d,
    last_response_time: d.last_response_time, last_check: d.last_check,
    heartbeats: d.heartbeats.map((h) => ({ status: h.status, maintenance: h.maintenance, response_time: h.response_time, created_at: h.created_at })),
    incidents: incidents.filter((i) => i.monitor_id === d.id).map(({ monitor_id, ...i }) => i),
  }));
  const overall = monitors.some((m) => m.status === 0) ? "down" : monitors.some((m) => m.status === 4) ? "maintenance" : monitors.some((m) => m.status === 2) ? "pending" : "up";
  res.json({ page: { slug: page.slug, title: page.title, description: page.description }, overall, monitors });
});
