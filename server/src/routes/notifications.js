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

// Ringkasan kesehatan tiap saluran: hasil pengiriman terakhir dan berapa kali
// gagal dalam 24 jam terakhir. Dipakai badge di daftar notifikasi supaya
// saluran yang mati terlihat tanpa perlu membuka riwayatnya satu per satu.
async function deliveryHealth() {
  const since = new Date(Date.now() - 86400_000);
  const [latest, failures] = await Promise.all([
    // DISTINCT ON: satu baris terbaru per notifikasi, dalam satu kueri
    prisma.$queryRaw`
      SELECT DISTINCT ON ("notification_id") "notification_id", "ok", "error", "created_at"
      FROM notification_logs
      WHERE "notification_id" IS NOT NULL
      ORDER BY "notification_id", "created_at" DESC`,
    prisma.notificationLog.groupBy({
      by: ["notification_id"],
      where: { ok: false, created_at: { gte: since }, notification_id: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const empty = () => ({ last_ok: null, last_error: null, last_sent_at: null, failures_24h: 0 });
  const byId = new Map();
  for (const row of latest) {
    byId.set(row.notification_id, {
      ...empty(), last_ok: row.ok, last_error: row.error, last_sent_at: row.created_at,
    });
  }
  for (const row of failures) {
    const current = byId.get(row.notification_id) || empty();
    byId.set(row.notification_id, { ...current, failures_24h: row._count._all });
  }
  return { byId, empty };
}

notificationsRouter.get("/", async (req, res) => {
  const [list, health] = await Promise.all([
    prisma.notification.findMany({ orderBy: { name: "asc" } }),
    deliveryHealth(),
  ]);
  res.json(list.map((n) => ({ ...n, delivery: health.byId.get(n.id) || health.empty() })));
});

// Riwayat pengiriman. `only=failed` menyaring yang gagal saja — itu yang
// biasanya dicari saat orang bertanya "kenapa saya tidak dapat alertnya?".
notificationsRouter.get("/logs", async (req, res) => {
  const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const where = {};
  const id = Number(req.query.notification_id);
  if (Number.isInteger(id) && id > 0) where.notification_id = id;
  if (req.query.only === "failed") where.ok = false;
  res.json(
    await prisma.notificationLog.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take,
    })
  );
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
  // Bila yang diuji adalah saluran yang sudah tersimpan, id-nya diteruskan
  // supaya hasilnya tercatat atas nama saluran itu dan badge-nya ikut
  // diperbarui — menguji ulang setelah memperbaiki token jadi terasa langsung.
  const id = Number(req.body?.id);
  const notification = { ...clean(req.body), ...(Number.isInteger(id) && id > 0 ? { id } : {}) };
  try {
    await sendNotification(notification, {
      event: "test", status: "up",
      title: "🔔 [Pulsewatch] Test notification",
      body: "Jika kamu menerima pesan ini, konfigurasi notifikasi sudah benar.",
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
