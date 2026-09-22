import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { config } from "../config.js";

// Kredensial monitor (Basic Auth / Bearer token) disimpan terenkripsi di database.
// AES-256-GCM: memberi kerahasiaan sekaligus deteksi perubahan ciphertext.
const ALGO = "aes-256-gcm";
const SALT = "pulsewatch-monitor-auth-v1"; // tetap: kunci harus sama antar restart

let cachedKey = null;
function key() {
  if (cachedKey) return cachedKey;
  const material = config.encryptionKey || config.jwtSecret;
  if (!material) throw new Error("ENCRYPTION_KEY atau JWT_SECRET harus diisi untuk menyimpan kredensial monitor");
  cachedKey = scryptSync(material, SALT, 32);
  return cachedKey;
}

// Format tersimpan: v1:<iv base64>:<authTag base64>:<ciphertext base64>
export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

// Mengembalikan null kalau nilainya tidak bisa dibuka (mis. ENCRYPTION_KEY berubah),
// supaya satu kredensial rusak tidak menjatuhkan seluruh scheduler.
export function decryptSecret(stored) {
  if (!stored) return null;
  const parts = String(stored).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const isEncrypted = (v) => typeof v === "string" && v.startsWith("v1:");
