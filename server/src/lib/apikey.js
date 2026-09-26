import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { hitLimit } from "./ratelimit.js";

// Kunci berbentuk pw_<64 hex> — awalan memudahkan membedakannya dari JWT
// saat dikirim lewat header Authorization: Bearer <...>.
const PREFIX = "pw_";
export const API_KEY_PATTERN = /^pw_[a-f0-9]{64}$/;
export const SCOPES = ["read", "write"];

export const looksLikeApiKey = (token) => API_KEY_PATTERN.test(String(token || ""));

// Kunci punya entropi 256 bit, jadi hash cepat sudah memadai — tidak perlu
// bcrypt yang lambat seperti pada password buatan manusia.
export const hashKey = (key) => createHash("sha256").update(String(key)).digest("hex");

export function generateKey() {
  const key = PREFIX + randomBytes(32).toString("hex");
  return {
    key,                                  // hanya ada di memori, ditampilkan sekali
    key_hash: hashKey(key),
    prefix: key.slice(0, 11),             // mis. pw_ab12cd34 untuk ditampilkan di daftar
  };
}

// Bandingkan hash dengan waktu tetap supaya tidak bocor lewat selisih waktu
function hashEquals(a, b) {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

// Catat pemakaian paling sering sekali per menit agar tidak menulis DB tiap request
const lastUsedWrite = new Map(); // id -> timestamp
function touch(apiKey) {
  const now = Date.now();
  if (now - (lastUsedWrite.get(apiKey.id) || 0) < 60_000) return;
  lastUsedWrite.set(apiKey.id, now);
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { last_used_at: new Date() } })
    .catch(() => {});
}

// Kembalikan kunci aktif yang cocok, atau null.
export async function resolveApiKey(token) {
  if (!looksLikeApiKey(token)) return null;
  const row = await prisma.apiKey.findUnique({ where: { key_hash: hashKey(token) } });
  if (!row || row.revoked_at) return null;
  if (!hashEquals(row.key_hash, hashKey(token))) return null;
  touch(row);
  return row;
}

// Rate limit per kunci — penyimpanannya mengikuti RATE_LIMIT_STORE (lib/ratelimit.js)
export const rateLimitApiKey = (apiKeyId) =>
  hitLimit(`apikey:${apiKeyId}`, { max: config.apiKeyMaxRequests, windowSeconds: config.apiKeyWindowSeconds });

// Tampilan aman untuk API: tidak pernah menyertakan hash maupun kunci asli
export const publicApiKey = (k) => ({
  id: k.id,
  label: k.label,
  prefix: k.prefix,
  scope: k.scope,
  created_by: k.created_by,
  created_at: k.created_at,
  last_used_at: k.last_used_at,
  revoked_at: k.revoked_at,
  active: !k.revoked_at,
});
