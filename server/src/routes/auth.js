import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import QRCode from "qrcode";
import { signToken, requireAuth, publicUser, denyApiKey } from "../lib/auth.js";
import { blockWhenLocked, clientIp, recordFailure, resetKey } from "../lib/ratelimit.js";
import { recordAudit } from "../lib/audit.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { newSecret, verifyCode, otpauthUrl, newRecoveryCodes, hashRecovery, consumeRecovery, TOTP_OFF } from "../lib/totp.js";

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
  // Password salah dan kode 2FA salah sama-sama dihitung ke rate limit login
  const fail = (body, summary) => {
    let wait = 0;
    for (const key of loginKeys(req)) wait = Math.max(wait, recordFailure(key));
    if (wait) {
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.` });
    }
    const name = String(username || "").slice(0, 60);
    recordAudit(req, {
      action: "auth.login_failed", entity: "auth", entityName: name,
      summary,
      actorFallback: name || "anonim",
      actorType: "anonymous", // username-nya baru klaim, belum terbukti
    });
    return res.status(401).json(body);
  };
  if (!ok) return fail({ error: "Username atau password salah" }, `Login gagal untuk "${String(username || "").slice(0, 60)}"`);

  // Password benar tapi akun memakai 2FA: klien diminta mengirim ulang
  // username + password bersama kode. Tanpa sesi setengah-login di server,
  // tidak ada state yang perlu dibersihkan bila pengguna batal di tengah jalan.
  let viaRecovery = false;
  if (user.totp_enabled) {
    const code = String(req.body?.code || "").trim();
    if (!code) return res.status(401).json({ error: "Masukkan kode 2FA", requires_2fa: true });
    const result = await checkSecondFactor(user, code);
    if (!result) return fail({ error: "Kode 2FA salah atau sudah dipakai", requires_2fa: true }, `Kode 2FA salah untuk "${user.username}"`);
    viaRecovery = result === "recovery";
  }

  for (const key of loginKeys(req)) resetKey(key);
  recordAudit(req, {
    action: "auth.login", entity: "auth", entityId: user.id, entityName: user.username,
    summary: viaRecovery ? `${user.username} login dengan kode cadangan 2FA` : `${user.username} login`,
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

// --- 2FA (TOTP) ---

// Kode dari aplikasi authenticator, atau kode cadangan. Pemakaian dicatat
// dengan update bersyarat supaya dua permintaan serentak dengan kode yang sama
// tidak bisa sama-sama lolos.
async function checkSecondFactor(user, code) {
  const secret = decryptSecret(user.totp_secret);
  const step = secret && verifyCode(secret, code, { lastStep: user.totp_last_step });
  if (step) {
    const { count } = await prisma.user.updateMany({
      where: { id: user.id, OR: [{ totp_last_step: null }, { totp_last_step: { lt: step } }] },
      data: { totp_last_step: step },
    });
    return count ? "totp" : null;
  }
  const rest = consumeRecovery(user.totp_recovery, code);
  if (!rest) return null;
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, totp_recovery: { equals: user.totp_recovery } },
    data: { totp_recovery: rest },
  });
  return count ? "recovery" : null;
}

// Hanya manusia yang login: API key tidak punya akun untuk diberi 2FA
const human = [requireAuth, denyApiKey];

const passwordOk = (user, password) => user && bcrypt.compareSync(String(password || ""), user.password_hash);

authRouter.get("/2fa", human, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({
    enabled: user.totp_enabled,
    recovery_remaining: user.totp_enabled && Array.isArray(user.totp_recovery) ? user.totp_recovery.length : 0,
  });
});

// Langkah 1: buat secret baru (belum aktif). Meminta password lagi supaya sesi
// yang tertinggal terbuka tidak bisa dipakai memasang authenticator orang lain.
authRouter.post("/2fa/setup", human, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!passwordOk(user, req.body?.password)) return res.status(400).json({ error: "Password salah" });
  if (user.totp_enabled) return res.status(409).json({ error: "2FA sudah aktif. Matikan dulu untuk memasang ulang." });
  const secret = newSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totp_secret: encryptSecret(secret), totp_last_step: null } });
  const url = otpauthUrl(secret, user.username);
  res.json({ secret, otpauth_url: url, qr_svg: await QRCode.toString(url, { type: "svg", margin: 1 }) });
});

// Langkah 2: buktikan authenticator sudah terpasang dengan satu kode yang benar.
// Sesi lain ikut dibatalkan — sama seperti ganti password.
authRouter.post("/2fa/enable", human, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (user.totp_enabled) return res.status(409).json({ error: "2FA sudah aktif" });
  const secret = decryptSecret(user.totp_secret);
  if (!secret) return res.status(400).json({ error: "Mulai pemasangan 2FA dulu" });
  const step = verifyCode(secret, req.body?.code);
  if (!step) return res.status(400).json({ error: "Kode salah. Periksa jam ponsel lalu coba lagi." });

  const codes = newRecoveryCodes();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { totp_enabled: true, totp_last_step: step, totp_recovery: codes.map(hashRecovery), password_changed_at: new Date() },
  });
  recordAudit(req, {
    action: "auth.2fa_enable", entity: "user", entityId: user.id, entityName: user.username,
    summary: `${user.username} mengaktifkan 2FA — sesi lain dibatalkan`,
  });
  // Kode cadangan hanya ditampilkan sekali ini; server tidak bisa menampilkannya lagi
  res.json({ ok: true, recovery_codes: codes, token: signToken(updated) });
});

// Ganti seluruh kode cadangan, mis. setelah beberapa terpakai
authRouter.post("/2fa/recovery", human, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.totp_enabled) return res.status(400).json({ error: "2FA belum aktif" });
  if (!passwordOk(user, req.body?.password)) return res.status(400).json({ error: "Password salah" });
  const codes = newRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { totp_recovery: codes.map(hashRecovery) } });
  recordAudit(req, {
    action: "auth.2fa_recovery", entity: "user", entityId: user.id, entityName: user.username,
    summary: `${user.username} membuat ulang kode cadangan 2FA`,
  });
  res.json({ recovery_codes: codes });
});

authRouter.post("/2fa/disable", human, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user.totp_enabled) return res.status(400).json({ error: "2FA belum aktif" });
  if (!passwordOk(user, req.body?.password)) return res.status(400).json({ error: "Password salah" });
  if (!(await checkSecondFactor(user, String(req.body?.code || "").trim()))) {
    return res.status(400).json({ error: "Kode 2FA salah atau sudah dipakai" });
  }
  await prisma.user.update({ where: { id: user.id }, data: TOTP_OFF });
  recordAudit(req, {
    action: "auth.2fa_disable", entity: "user", entityId: user.id, entityName: user.username,
    summary: `${user.username} mematikan 2FA`,
  });
  res.json({ ok: true });
});
