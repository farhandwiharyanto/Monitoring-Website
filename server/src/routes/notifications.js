import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { sendNotification, NOTIFICATION_TYPES } from "../notifications/index.js";
import { recordAudit, diffFields } from "../lib/audit.js";

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
  const created = await prisma.notification.create({ data });
  recordAudit(req, {
    action: "notification.create", entity: "notification", entityId: created.id, entityName: created.name,
    summary: `Notifikasi ${created.type} "${created.name}" dibuat`,
  });
  res.status(201).json(created);
});

notificationsRouter.put("/:id", async (req, res) => {
  const data = clean(req.body);
  if (!data.name || !TYPES.includes(data.type)) return res.status(400).json({ error: "Nama/tipe tidak valid" });
  const id = Number(req.params.id);
  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Notifikasi tidak ditemukan" });
  const updated = await prisma.notification.update({ where: { id }, data });
  recordAudit(req, {
    action: "notification.update", entity: "notification", entityId: id, entityName: updated.name,
    summary: `Notifikasi "${updated.name}" diubah`,
    // Isi `config` berisi token/webhook URL, jadi hanya dicatat "berubah"
    changes: diffFields(existing, data),
  });
  res.json(updated);
});

notificationsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.notification.findUnique({ where: { id } });
  await prisma.notification.delete({ where: { id } }).catch(() => {});
  if (existing) {
    recordAudit(req, {
      action: "notification.delete", entity: "notification", entityId: id, entityName: existing.name,
      summary: `Notifikasi ${existing.type} "${existing.name}" dihapus`,
    });
  }
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
