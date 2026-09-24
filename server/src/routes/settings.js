import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { recordAudit, diffFields } from "../lib/audit.js";

// Pengaturan tampilan global: jadi nilai awal untuk user yang belum pernah memilih.
export const settingsRouter = Router();

const KEY = "appearance";
const DEFAULTS = { language: "id", theme: "dark" };
const LANGUAGES = ["id", "en"];
const THEMES = ["dark", "light", "auto"];

export async function getAppearance() {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return { ...DEFAULTS, ...(row?.value || {}) };
}

// Dibaca halaman publik juga (status page ikut bahasa default instance)
settingsRouter.get("/public", async (req, res) => res.json(await getAppearance()));

settingsRouter.get("/", requireAuth, async (req, res) => res.json(await getAppearance()));

settingsRouter.put("/", requireAuth, requireAdmin, async (req, res) => {
  const current = await getAppearance();
  const next = { ...current };
  if (req.body?.language !== undefined) {
    if (!LANGUAGES.includes(req.body.language)) return res.status(400).json({ error: "Bahasa tidak didukung" });
    next.language = req.body.language;
  }
  if (req.body?.theme !== undefined) {
    if (!THEMES.includes(req.body.theme)) return res.status(400).json({ error: "Tema tidak dikenal" });
    next.theme = req.body.theme;
  }
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: next }, create: { key: KEY, value: next } });
  recordAudit(req, {
    action: "settings.update", entity: "settings", entityName: KEY,
    summary: `Tampilan default instance diubah (bahasa ${next.language}, tema ${next.theme})`,
    changes: diffFields(current, next),
  });
  res.json(next);
});
