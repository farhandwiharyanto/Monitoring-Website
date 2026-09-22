import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { sendNotification } from "../notifications/index.js";

// Konfigurasi notifikasi berisi token/kredensial → seluruh router admin-only
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireAdmin);

const TYPES = ["telegram", "discord", "email", "webhook"];

notificationsRouter.get("/", async (req, res) => {
  res.json(await prisma.notification.findMany({ orderBy: { name: "asc" } }));
});

notificationsRouter.post("/", async (req, res) => {
  const { name, type, config, is_default } = req.body || {};
  if (!name || !TYPES.includes(type)) return res.status(400).json({ error: "Nama/tipe tidak valid" });
  res.status(201).json(await prisma.notification.create({ data: { name, type, config: config || {}, is_default: !!is_default } }));
});

notificationsRouter.put("/:id", async (req, res) => {
  const { name, type, config, is_default } = req.body || {};
  if (!name || !TYPES.includes(type)) return res.status(400).json({ error: "Nama/tipe tidak valid" });
  try {
    res.json(await prisma.notification.update({ where: { id: Number(req.params.id) }, data: { name, type, config: config || {}, is_default: !!is_default } }));
  } catch {
    res.status(404).json({ error: "Notifikasi tidak ditemukan" });
  }
});

notificationsRouter.delete("/:id", async (req, res) => {
  await prisma.notification.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.json({ ok: true });
});

// Kirim pesan uji (bisa untuk yang belum tersimpan)
notificationsRouter.post("/test", async (req, res) => {
  try {
    await sendNotification(req.body, {
      event: "test", status: "up",
      title: "🔔 [Pulsewatch] Test notification",
      body: "Jika kamu menerima pesan ini, konfigurasi notifikasi sudah benar.",
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
