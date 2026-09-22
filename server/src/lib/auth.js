import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: user.role }, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

export const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at });

// Express middleware: butuh header Authorization: Bearer <token>.
// User dibaca ulang dari DB agar perubahan role / penghapusan user langsung berlaku.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = publicUser(user);
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
