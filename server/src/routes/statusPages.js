import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, monitorInclude } from "../lib/stats.js";
import { config } from "../config.js";
import { recordAudit, diffFields } from "../lib/audit.js";

export const statusPagesRouter = Router();   // admin (butuh auth)
export const publicStatusRouter = Router();  // publik tanpa login

const include = {
  monitors: { select: { monitor_id: true }, orderBy: { sort_order: "asc" } },
  tags: { select: { tag_id: true } },
};
const shape = ({ monitors, tags, ...p }) => ({
  ...p,
  monitor_ids: monitors.map((m) => m.monitor_id),
  tag_ids: (tags || []).map((t) => t.tag_id),
});

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

// Monitor bisa dipilih lewat tag/group; gabungan tag dan pilihan langsung.
async function syncTags(pageId, ids) {
  if (!Array.isArray(ids)) return;
  const valid = await prisma.tag.findMany({ where: { id: { in: ids.map(Number).filter(Number.isFinite) } }, select: { id: true } });
  await prisma.statusPageTag.deleteMany({ where: { status_page_id: pageId } });
  await prisma.statusPageTag.createMany({
    data: valid.map((t) => ({ status_page_id: pageId, tag_id: t.id })),
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
  await syncTags(page.id, req.body?.tag_ids);
  recordAudit(req, {
    action: "status_page.create", entity: "status_page", entityId: page.id, entityName: page.title,
    summary: `Status page "${page.title}" dibuat di /status/${page.slug}`,
  });
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
  const data = {
    slug,
    title: title ? String(title).slice(0, 120) : existing.title,
    description: description !== undefined ? (description ? String(description).slice(0, 500) : null) : existing.description,
    published: published !== false,
    ...look,
  };
  await prisma.statusPage.update({ where: { id }, data });
  await syncMonitors(id, monitor_ids);
  await syncTags(id, req.body?.tag_ids);
  recordAudit(req, {
    action: "status_page.update", entity: "status_page", entityId: id, entityName: data.title,
    summary: `Status page "${data.title}" diubah`,
    changes: diffFields(existing, data),
  });
  res.json(shape(await prisma.statusPage.findUnique({ where: { id }, include })));
});
statusPagesRouter.delete("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.statusPage.findUnique({ where: { id } });
  await prisma.statusPage.delete({ where: { id } }).catch(() => {});
  if (existing) {
    recordAudit(req, {
      action: "status_page.delete", entity: "status_page", entityId: id, entityName: existing.title,
      summary: `Status page "${existing.title}" (/status/${existing.slug}) dihapus`,
    });
  }
  res.json({ ok: true });
});

// ---- Public ----

// Halaman mana yang dilayani untuk domain ini? Dipakai SPA agar custom domain
// langsung menampilkan status page di path "/".
// Host yang dilihat pengunjung. Di belakang reverse proxy, nginx/traefik
// meneruskan domain asli lewat X-Forwarded-Host; header itu hanya dipercaya
// bila TRUST_PROXY aktif supaya tidak bisa dipalsukan klien langsung.
export function requestHost(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    if (fwd) return hostify(fwd);
  }
  return hostify(req.headers.host || "");
}

// Selalu 200: domain biasa cukup mendapat slug null, bukan error.
publicStatusRouter.get("/resolve", async (req, res) => {
  const host = requestHost(req);
  if (!host) return res.json({ slug: null });
  const page = await prisma.statusPage.findFirst({ where: { custom_domain: host, published: true }, select: { slug: true } });
  res.json({ slug: page ? page.slug : null });
});

publicStatusRouter.get("/:slug", async (req, res) => {
  const page = await prisma.statusPage.findFirst({
    where: { slug: req.params.slug, published: true },
    include: {
      monitors: { orderBy: { sort_order: "asc" }, include: { monitor: { include: monitorInclude } } },
      tags: { include: { tag: true } },
    },
  });
  if (!page) return res.status(404).json({ error: "Status page tidak ditemukan" });

  // Monitor yang ditampilkan = pilihan langsung + semua monitor bertag terpilih.
  // Pilihan langsung tampil dulu sesuai urutannya, sisanya menyusul per nama.
  const direct = page.monitors.map((x) => x.monitor);
  const seen = new Set(direct.map((m) => m.id));
  const tagIds = page.tags.map((t) => t.tag_id);
  if (tagIds.length) {
    const byTag = await prisma.monitor.findMany({
      where: { tags: { some: { tag_id: { in: tagIds } } } },
      include: monitorInclude,
      orderBy: { name: "asc" },
    });
    for (const m of byTag) if (!seen.has(m.id)) { seen.add(m.id); direct.push(m); }
  }

  const decorated = await decorateMonitors(direct, { beats: 30 });
  const since = new Date(Date.now() - 7 * 86400_000);
  const incidents = page.show_incidents
    ? await prisma.incident.findMany({
        where: { monitor_id: { in: decorated.map((d) => d.id) }, started_at: { gte: since } },
        orderBy: { started_at: "desc" },
        select: {
          id: true, monitor_id: true, started_at: true, resolved_at: true, maintenance: true,
          // Kabar manual dari admin — satu-satunya teks incident yang tampil ke publik
          updates: { orderBy: { created_at: "desc" }, select: { status: true, message: true, created_at: true } },
        },
      })
    : [];

  // Hanya expose data yang aman untuk publik. URL/hostname, port, konfigurasi
  // check, pesan heartbeat, dan penyebab incident sengaja TIDAK disertakan.
  const monitors = decorated.map((d) => ({
    id: d.id, name: d.name, type: d.type, status: d.status, in_maintenance: d.in_maintenance,
    // Cukup penandanya; ambang latency-nya sendiri tetap tidak dibuka ke publik
    degraded: d.last_degraded,
    tags: d.tags,
    uptime_24h: d.uptime_24h, uptime_30d: d.uptime_30d,
    last_response_time: d.last_response_time, last_check: d.last_check,
    heartbeats: page.show_bars
      ? d.heartbeats.map((h) => ({ status: h.status, maintenance: h.maintenance, degraded: h.degraded, response_time: h.response_time, created_at: h.created_at }))
      : [],
    incidents: incidents.filter((i) => i.monitor_id === d.id).map(({ monitor_id, ...i }) => i),
  }));
  // Urutan keparahan: satu yang mati mengalahkan segalanya, lalu maintenance,
  // lalu melambat — degraded ditaruh di atas pending karena artinya jelas bagi
  // pembaca status page, sedangkan pending hanya keadaan sesaat saat retry.
  const has = (code) => monitors.some((m) => m.status === code);
  const overall = has(0) ? "down" : has(4) ? "maintenance" : has(5) ? "degraded" : has(2) ? "pending" : "up";
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
