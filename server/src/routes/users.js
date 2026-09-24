import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma, ROLES } from "../db.js";
import { requireAuth, requireAdmin, publicUser } from "../lib/auth.js";
import { recordAudit, diffFields } from "../lib/audit.js";

// Manajemen user — admin only
export const usersRouter = Router();
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get("/", async (req, res) => {
  const rows = await prisma.user.findMany({
    orderBy: { username: "asc" },
    include: { oncall_notification: { select: { id: true, name: true, type: true } } },
  });
  // Nama kontak on-call ikut dibawa supaya daftar user bisa menampilkannya
  // tanpa memanggil router notifikasi (yang admin-only karena berisi kredensial).
  res.json(rows.map((u) => ({ ...publicUser(u), oncall_notification: u.oncall_notification || null })));
});

usersRouter.post("/", async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return res.status(400).json({ error: "Username 3–32 karakter (huruf, angka, . _ -)" });
  if (!password || String(password).length < 8) return res.status(400).json({ error: "Password minimal 8 karakter" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Role tidak valid" });
  if (await prisma.user.findUnique({ where: { username } })) return res.status(400).json({ error: "Username sudah dipakai" });
  const user = await prisma.user.create({ data: { username, role, password_hash: bcrypt.hashSync(password, 10) } });
  recordAudit(req, {
    action: "user.create", entity: "user", entityId: user.id, entityName: user.username,
    summary: `User "${user.username}" dibuat dengan role ${user.role}`,
  });
  res.status(201).json(publicUser(user));
});

usersRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "User tidak ditemukan" });
  const { role, password } = req.body || {};
  const data = {};
  // Kontak on-call: dikirim kosong berarti dilepas, tidak dikirim berarti dibiarkan
  if (req.body?.oncall_notification_id !== undefined) {
    const raw = req.body.oncall_notification_id;
    if (raw === null || raw === "") data.oncall_notification_id = null;
    else {
      const nid = Number(raw);
      if (!Number.isFinite(nid) || !(await prisma.notification.findUnique({ where: { id: nid } }))) {
        return res.status(400).json({ error: "Notifikasi kontak on-call tidak ditemukan" });
      }
      data.oncall_notification_id = nid;
    }
  }
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Role tidak valid" });
    if (user.id === req.user.id && role !== "admin") return res.status(400).json({ error: "Tidak bisa menurunkan role diri sendiri" });
    data.role = role;
  }
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: "Password minimal 8 karakter" });
    data.password_hash = bcrypt.hashSync(password, 10);
    // Reset password oleh admin juga membatalkan sesi user tersebut
    data.password_changed_at = new Date();
  }
  const updated = await prisma.user.update({ where: { id }, data });
  recordAudit(req, {
    action: "user.update", entity: "user", entityId: id, entityName: updated.username,
    summary: data.password_hash
      ? `Password "${updated.username}" direset admin — sesinya ikut dibatalkan`
      : data.oncall_notification_id !== undefined
        ? `Kontak on-call "${updated.username}" diubah`
        : `User "${updated.username}" diubah`,
    changes: diffFields(user, data),
  });
  res.json(publicUser(updated));
});

usersRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri" });
  const admins = await prisma.user.count({ where: { role: "admin" } });
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return res.status(404).json({ error: "User tidak ditemukan" });
  if (target.role === "admin" && admins <= 1) return res.status(400).json({ error: "Harus tersisa minimal satu admin" });
  await prisma.user.delete({ where: { id } });
  recordAudit(req, {
    action: "user.delete", entity: "user", entityId: id, entityName: target.username,
    summary: `User "${target.username}" (${target.role}) dihapus`,
  });
  res.json({ ok: true });
});
