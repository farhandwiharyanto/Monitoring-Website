import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { signToken, requireAuth, publicUser } from "../lib/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { username: String(username || "") } });
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "Username atau password salah" });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !bcrypt.compareSync(currentPassword || "", user.password_hash)) {
    return res.status(400).json({ error: "Password saat ini salah" });
  }
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Password baru minimal 6 karakter" });
  await prisma.user.update({ where: { id: user.id }, data: { password_hash: bcrypt.hashSync(newPassword, 10) } });
  res.json({ ok: true });
});
