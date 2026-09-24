import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma, ROLES } from "../db.js";
import { requireAuth, requireAdmin, publicUser } from "../lib/auth.js";
import { recordAudit, diffFields } from "../lib/audit.js";

// Manajemen user — admin only
export const usersRouter = Router();
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get("/", async (req, res) => {
  res.json((await prisma.user.findMany({ orderBy: { username: "asc" } })).map(publicUser));
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
