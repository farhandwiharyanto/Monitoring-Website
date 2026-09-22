import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { looksLikeApiKey, resolveApiKey, rateLimitApiKey } from "./apikey.js";

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

export const bearerToken = (req) => {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

// API key dipetakan ke role yang setara supaya seluruh pengecekan role yang
// sudah ada tetap berlaku: scope read = viewer, scope write = admin.
const roleForScope = (scope) => (scope === "write" ? "admin" : "viewer");

// Express middleware: menerima JWT hasil login maupun API key, keduanya lewat
// header Authorization: Bearer <token>.
export async function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  if (looksLikeApiKey(token)) {
    const apiKey = await resolveApiKey(token);
    if (!apiKey) return res.status(401).json({ error: "API key tidak valid atau sudah dicabut" });

    // Kunci read-only tidak boleh mengubah apa pun
    if (apiKey.scope !== "write" && req.method !== "GET") {
      return res.status(403).json({ error: "API key ini read-only" });
    }

    const limit = rateLimitApiKey(apiKey.id);
    res.set("X-RateLimit-Limit", String(config.apiKeyMaxRequests));
    res.set("X-RateLimit-Remaining", String(Math.max(0, limit.remaining)));
    if (!limit.allowed) {
      res.set("Retry-After", String(limit.retryAfter));
      return res.status(429).json({ error: `Rate limit API key terlampaui, coba lagi dalam ${limit.retryAfter} detik.` });
    }

    req.apiKey = apiKey;
    req.user = { id: null, username: `apikey:${apiKey.label}`, role: roleForScope(apiKey.scope) };
    return next();
  }

  const user = await userFromToken(token);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  next();
}

// Endpoint yang hanya boleh diakses manusia yang login: manajemen user,
// manajemen API key itu sendiri, dan kredensial notifikasi. Mencegah satu
// API key dipakai menaikkan hak aksesnya sendiri.
//
// Memeriksa token mentah selain req.apiKey, supaya tetap benar saat dipasang
// SEBELUM requireAuth (mis. saat di-mount di app.use) maupun sesudahnya.
export function denyApiKey(req, res, next) {
  if (req.apiKey || looksLikeApiKey(bearerToken(req))) {
    return res.status(403).json({ error: "Endpoint ini tidak bisa diakses dengan API key" });
  }
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
