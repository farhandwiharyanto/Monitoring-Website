import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { sendNotification, NOTIFICATION_TYPES } from "../notifications/index.js";

// Konfigurasi notifikasi berisi token/kredensial → seluruh router admin-only
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireAdmin);

const TYPES = NOTIFICATION_TYPES;

// config selalu object polos; nama dibatasi panjangnya
function clean(body) {
  const name = String(body?.name || "").trim().slice(0, 100);
  const type = body?.type;
  const cfg = body?.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
  return { name, type, config: cfg, is_default: !!body?.is_default };
}

notificationsRouter.get("/", async (req, res) => {
  res.json(await prisma.notification.findMany({ orderBy: { name: "asc" } }));
});

notificationsRouter.post("/", async (req, res) => {
  const data = clean(req.body);
  if (!data.name || !TYPES.includes(data.type)) return res.status(400).json({ error: "Nama/tipe tidak valid" });
  res.status(201).json(await prisma.notification.create({ data }));
});

notificationsRouter.put("/:id", async (req, res) => {
  const data = clean(req.body);
  if (!data.name || !TYPES.includes(data.type)) return res.status(400).json({ error: "Nama/tipe tidak valid" });
  try {
    res.json(await prisma.notification.update({ where: { id: Number(req.params.id) }, data }));
  } catch {
    res.status(404).json({ error: "Notifikasi tidak ditemukan" });
  }
});

notificationsRouter.delete("/:id", async (req, res) => {
  await prisma.notification.delete({ where: { id: Number(req.params.id) } }).catch(() => {});
  res.json({ ok: true });
});

// Kirim pesan uji (bisa untuk yang belum tersimpan). Tanpa retry supaya
// error konfigurasi langsung terlihat di UI.
notificationsRouter.post("/test", async (req, res) => {
  try {
    await sendNotification(clean(req.body), {
      event: "test", status: "up",
      title: "🔔 [Pulsewatch] Test notification",
      body: "Jika kamu menerima pesan ini, konfigurasi notifikasi sudah benar.",
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
