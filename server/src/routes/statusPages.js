import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, monitorInclude } from "../lib/stats.js";

export const statusPagesRouter = Router();   // admin (butuh auth)
export const publicStatusRouter = Router();  // publik tanpa login

const include = { monitors: { select: { monitor_id: true }, orderBy: { sort_order: "asc" } } };
const shape = ({ monitors, ...p }) => ({ ...p, monitor_ids: monitors.map((m) => m.monitor_id) });

const THEMES = ["dark", "light", "auto"];
// "resolve" dipakai endpoint pencarian custom domain di bawah
const RESERVED_SLUGS = ["resolve"];
const ANNOUNCEMENT_STYLES = ["info", "warning", "critical"];

async function syncMonitors(pageId, ids) {
  if (!Array.isArray(ids)) return;
  const valid = await prisma.monitor.findMany({ where: { id: { in: ids.map(Number).filter(Number.isFinite) } }, select: { id: true } });
  const order = ids.map(Number);
  await prisma.statusPageMonitor.deleteMany({ where: { status_page_id: pageId } });
  await prisma.statusPageMonitor.createMany({
    data: valid
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .map((m, i) => ({ status_page_id: pageId, monitor_id: m.id, sort_order: i })),
    skipDuplicates: true,
  });
}

const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const hostify = (s) => {
  const v = String(s || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : null;
};

// Field kustomisasi tampilan — divalidasi terpisah dari data inti halaman
function appearance(body, existing = {}) {
  const out = {};
  if (body.logo_url !== undefined) {
    const v = String(body.logo_url || "").trim().slice(0, 500);
    if (v && !/^https?:\/\//i.test(v)) throw new Error("URL logo harus diawali http:// atau https://");
    out.logo_url = v || null;
  }
  if (body.accent_color !== undefined) {
    const v = String(body.accent_color || "").trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error("Warna aksen harus format hex, mis. #38bdf8");
    out.accent_color = v.toLowerCase();
  }
  if (body.theme !== undefined) {
    if (!THEMES.includes(body.theme)) throw new Error("Tema tidak dikenal");
    out.theme = body.theme;
  }
  if (body.show_uptime !== undefined) out.show_uptime = !!body.show_uptime;
  if (body.show_bars !== undefined) out.show_bars = !!body.show_bars;
  if (body.show_incidents !== undefined) out.show_incidents = !!body.show_incidents;
  if (body.footer_text !== undefined) out.footer_text = String(body.footer_text || "").trim().slice(0, 300) || null;
  if (body.announcement !== undefined) out.announcement = String(body.announcement || "").trim().slice(0, 2000) || null;
  if (body.announcement_style !== undefined) {
    if (!ANNOUNCEMENT_STYLES.includes(body.announcement_style)) throw new Error("Gaya pengumuman tidak dikenal");
    out.announcement_style = body.announcement_style;
  }
  if (body.custom_domain !== undefined) {
    const raw = String(body.custom_domain || "").trim();
    if (!raw) out.custom_domain = null;
    else {
      const host = hostify(raw);
      if (!host) throw new Error("Domain tidak valid (contoh: status.domain.com)");
      out.custom_domain = host;
    }
  }
  return { ...existing, ...out };
}

statusPagesRouter.use(requireAuth);
statusPagesRouter.get("/", async (req, res) => {
  res.json((await prisma.statusPage.findMany({ include, orderBy: { title: "asc" } })).map(shape));
});
statusPagesRouter.post("/", requireAdmin, async (req, res) => {
  const { title, description, published, monitor_ids } = req.body || {};
  const slug = slugify(req.body.slug || title);
  if (!title || !slug) return res.status(400).json({ error: "Judul/slug wajib diisi" });
  if (RESERVED_SLUGS.includes(slug)) return res.status(400).json({ error: `Slug "${slug}" dipakai sistem, pilih yang lain` });
  if (await prisma.statusPage.findUnique({ where: { slug } })) return res.status(400).json({ error: "Slug sudah dipakai" });
  let look;
  try { look = appearance(req.body || {}); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (look.custom_domain && (await prisma.statusPage.findUnique({ where: { custom_domain: look.custom_domain } }))) {
    return res.status(400).json({ error: "Domain sudah dipakai status page lain" });
  }
  const page = await prisma.statusPage.create({
    data: { slug, title: String(title).slice(0, 120), description: description ? String(description).slice(0, 500) : null, published: published !== false, ...look },
  });
  await syncMonitors(page.id, monitor_ids);
  res.status(201).json(shape(await prisma.statusPage.findUnique({ where: { id: page.id }, include })));
});
statusPagesRouter.put("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.statusPage.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Status page tidak ditemukan" });
  const { title, description, published, monitor_ids } = req.body || {};
  const slug = slugify(req.body.slug || title || existing.slug);
  if (RESERVED_SLUGS.includes(slug)) return res.status(400).json({ error: `Slug "${slug}" dipakai sistem, pilih yang lain` });
  if (await prisma.statusPage.findFirst({ where: { slug, NOT: { id } } })) return res.status(400).json({ error: "Slug sudah dipakai" });
  let look;
  try { look = appearance(req.body || {}); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (look.custom_domain && (await prisma.statusPage.findFirst({ where: { custom_domain: look.custom_domain, NOT: { id } } }))) {
    return res.status(400).json({ error: "Domain sudah dipakai status page lain" });
  }
  await prisma.statusPage.update({
    where: { id },
    data: {
      slug,
      title: title ? String(title).slice(0, 120) : existing.title,
      description: description !== undefined ? (description ? String(description).slice(0, 500) : null) : existing.description,
      published: published !== false,
      ...look,
    },
  });
  await syncMonitors(id, monitor_ids);
  res.json(shape(await prisma.statusPage.findUnique({ where: { id }, include })));
});
statusPagesRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.statusPage.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.json({ ok: true });
});

// ---- Public ----

// Halaman mana yang dilayani untuk domain ini? Dipakai SPA agar custom domain
// langsung menampilkan status page di path "/".
publicStatusRouter.get("/resolve", async (req, res) => {
  const host = hostify(req.headers.host || "");
  if (!host) return res.status(404).json({ error: "Tidak ada status page untuk domain ini" });
  const page = await prisma.statusPage.findFirst({ where: { custom_domain: host, published: true }, select: { slug: true } });
  if (!page) return res.status(404).json({ error: "Tidak ada status page untuk domain ini" });
  res.json({ slug: page.slug });
});

publicStatusRouter.get("/:slug", async (req, res) => {
  const page = await prisma.statusPage.findFirst({
    where: { slug: req.params.slug, published: true },
    include: { monitors: { orderBy: { sort_order: "asc" }, include: { monitor: { include: monitorInclude } } } },
  });
  if (!page) return res.status(404).json({ error: "Status page tidak ditemukan" });
  const decorated = await decorateMonitors(page.monitors.map((x) => x.monitor), { beats: 30 });
  const since = new Date(Date.now() - 7 * 86400_000);
  const incidents = page.show_incidents
    ? await prisma.incident.findMany({
        where: { monitor_id: { in: decorated.map((d) => d.id) }, started_at: { gte: since } },
        orderBy: { started_at: "desc" },
        select: { monitor_id: true, started_at: true, resolved_at: true, maintenance: true },
      })
    : [];
  // Hanya expose data yang aman untuk publik
  const monitors = decorated.map((d) => ({
    id: d.id, name: d.name, type: d.type, status: d.status, in_maintenance: d.in_maintenance,
    tags: d.tags,
    uptime_24h: d.uptime_24h, uptime_30d: d.uptime_30d,
    last_response_time: d.last_response_time, last_check: d.last_check,
    heartbeats: page.show_bars
      ? d.heartbeats.map((h) => ({ status: h.status, maintenance: h.maintenance, response_time: h.response_time, created_at: h.created_at }))
      : [],
    incidents: incidents.filter((i) => i.monitor_id === d.id).map(({ monitor_id, ...i }) => i),
  }));
  const overall = monitors.some((m) => m.status === 0) ? "down" : monitors.some((m) => m.status === 4) ? "maintenance" : monitors.some((m) => m.status === 2) ? "pending" : "up";
  res.json({
    page: {
      slug: page.slug, title: page.title, description: page.description,
      logo_url: page.logo_url, accent_color: page.accent_color, theme: page.theme,
      show_uptime: page.show_uptime, show_bars: page.show_bars, show_incidents: page.show_incidents,
      footer_text: page.footer_text,
      announcement: page.announcement, announcement_style: page.announcement_style,
    },
    overall,
    monitors,
  });
});
