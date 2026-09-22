import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, config.jwtSecret, { expiresIn: config.jwtTtl });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

export const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at });

// Token yang diterbitkan sebelum password terakhir diganti dianggap batal,
// sehingga ganti password langsung mengusir semua sesi lama.
function tokenStillValid(payload, user) {
  if (!payload?.iat || !user.password_changed_at) return true;
  // `iat` dibulatkan ke bawah ke detik, jadi password_changed_at dibulatkan sama.
  // Token yang baru diterbitkan tepat setelah ganti password tetap lolos karena
  // kedua nilai jatuh pada detik yang sama; token lama dari detik sebelumnya batal.
  return payload.iat >= Math.floor(new Date(user.password_changed_at).getTime() / 1000);
}

// Resolusi token -> user aktif, atau null. Dipakai middleware HTTP dan Socket.io.
export async function userFromToken(token) {
  const payload = token && verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !tokenStillValid(payload, user)) return null;
  return publicUser(user);
}

// Express middleware: butuh header Authorization: Bearer <token>.
// User dibaca ulang dari DB agar perubahan role / penghapusan user langsung berlaku.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const user = await userFromToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}

// Batasi endpoint ke role tertentu. Dipasang setelah requireAuth.
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: "Akses ditolak: butuh role " + roles.join("/") });
  }
  next();
};
export const requireAdmin = requireRole("admin");
