import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { signToken, requireAuth, publicUser } from "../lib/auth.js";
import { blockWhenLocked, clientIp, recordFailure, resetKey } from "../lib/ratelimit.js";
import { recordAudit } from "../lib/audit.js";

export const authRouter = Router();

// Kunci rate limit: per IP dan per username, supaya brute force dari satu IP
// maupun ke satu akun dari banyak IP sama-sama tertahan.
const loginKeys = (req) => {
  const keys = [`login:ip:${clientIp(req)}`];
  const u = String(req.body?.username || "").trim().toLowerCase();
  if (u) keys.push(`login:user:${u}`);
  return keys;
};

authRouter.post("/login", blockWhenLocked(loginKeys), async (req, res) => {
  const { username, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { username: String(username || "") } });
  const ok = user && bcrypt.compareSync(String(password || ""), user.password_hash);
  if (!ok) {
    let wait = 0;
    for (const key of loginKeys(req)) wait = Math.max(wait, recordFailure(key));
    if (wait) {
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.` });
    }
    recordAudit(req, {
      action: "auth.login_failed", entity: "auth", entityName: String(username || "").slice(0, 60),
      summary: `Login gagal untuk "${String(username || "").slice(0, 60)}"`,
      actorFallback: String(username || "").slice(0, 60) || "anonim",
      actorType: "anonymous", // username-nya baru klaim, belum terbukti
    });
    return res.status(401).json({ error: "Username atau password salah" });
  }
  for (const key of loginKeys(req)) resetKey(key);
  recordAudit(req, {
    action: "auth.login", entity: "auth", entityId: user.id, entityName: user.username,
    summary: `${user.username} login`,
    actorFallback: user.username, actorType: "user", actorId: user.id,
  });
  res.json({ token: signToken(user), user: publicUser(user) });
});

authRouter.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user || !bcrypt.compareSync(String(currentPassword || ""), user.password_hash)) {
    return res.status(400).json({ error: "Password saat ini salah" });
  }
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: "Password baru minimal 8 karakter" });
  if (newPassword === currentPassword) return res.status(400).json({ error: "Password baru harus berbeda dari password saat ini" });
  const updated = await prisma.user.update({
    where: { id: user.id },
    // password_changed_at membatalkan semua token lama (termasuk di perangkat lain)
    data: { password_hash: bcrypt.hashSync(newPassword, 10), password_changed_at: new Date() },
  });
  recordAudit(req, {
    action: "auth.password_change", entity: "user", entityId: user.id, entityName: user.username,
    summary: `${user.username} mengganti password sendiri — semua sesi lama dibatalkan`,
  });
  // Token baru dikembalikan agar sesi yang sedang dipakai tidak ikut terputus
  res.json({ ok: true, token: signToken(updated) });
});
