import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

const PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#fb923c", "#facc15", "#34d399", "#60a5fa", "#f87171", "#2dd4bf", "#c084fc"];
export const slugTag = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
const pickColor = (name) => PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

// Terima array string atau {name, color}; buat tag yang belum ada; kembalikan id
export async function upsertTags(input) {
  if (!Array.isArray(input)) return null;
  const ids = [];
  for (const t of input) {
    const name = slugTag(typeof t === "string" ? t : t?.name);
    if (!name) continue;
    const color = typeof t === "object" && t?.color ? t.color : undefined;
    const tag = await prisma.tag.upsert({
      where: { name },
      update: color ? { color } : {},
      create: { name, color: color || pickColor(name) },
    });
    ids.push(tag.id);
  }
  return [...new Set(ids)];
}

tagsRouter.get("/", async (req, res) => {
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { monitors: true } } } });
  res.json(tags.map(({ _count, ...t }) => ({ ...t, monitor_count: _count.monitors })));
});

tagsRouter.post("/", requireAdmin, async (req, res) => {
  const name = slugTag(req.body?.name);
  if (!name) return res.status(400).json({ error: "Nama tag wajib diisi" });
  if (await prisma.tag.findUnique({ where: { name } })) return res.status(400).json({ error: "Tag sudah ada" });
  res.status(201).json(await prisma.tag.create({ data: { name, color: req.body?.color || pickColor(name) } }));
});

tagsRouter.put("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const data = {};
  if (req.body?.name) data.name = slugTag(req.body.name);
  if (req.body?.color) data.color = req.body.color;
  try {
    res.json(await prisma.tag.update({ where: { id }, data }));
  } catch {
    res.status(400).json({ error: "Tag tidak ditemukan atau nama sudah dipakai" });
  }
});

tagsRouter.delete("/:id", requireAdmin, async (req, res) => {
  await prisma.tag.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.json({ ok: true });
});
