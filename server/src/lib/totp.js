import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// TOTP (RFC 6238) ditulis sendiri: intinya hanya HMAC-SHA1 atas nomor langkah
// waktu, jadi tidak sepadan menambah dependensi. Parameternya yang dipakai semua
// aplikasi authenticator: SHA-1, 6 digit, langkah 30 detik.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Secret base32 tidak valid");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(randomBytes(20));

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);

export function codeForStep(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

const sameCode = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Langkah waktu yang cocok, atau null. Toleransi satu langkah ke depan/belakang
// untuk jam ponsel yang sedikit meleset. Langkah yang sudah pernah dipakai
// (lastStep) ditolak supaya kode yang terintip tidak bisa dipakai ulang.
export function verifyCode(secret, code, { lastStep = null, now = Date.now(), window = 1 } = {}) {
  const input = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(input)) return null;
  const current = stepAt(now);
  for (let d = -window; d <= window; d += 1) {
    const step = current + d;
    if (lastStep !== null && step <= lastStep) continue;
    if (sameCode(codeForStep(secret, step), input)) return step;
  }
  return null;
}

export const otpauthUrl = (secret, username, issuer = "Pulsewatch") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${username}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

// Kode cadangan: 10 buah, sekali pakai, format xxxx-xxxx supaya mudah diketik.
// Yang disimpan hanya SHA-256-nya — entropinya sudah cukup tinggi sehingga
// hash lambat seperti bcrypt tidak diperlukan.
const normalizeRecovery = (c) => String(c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecovery = (c) => createHash("sha256").update(normalizeRecovery(c)).digest("hex");

export function newRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

// Sisa hash setelah satu kode cadangan dipakai, atau null bila kodenya salah
export function consumeRecovery(hashes, code) {
  if (normalizeRecovery(code).length !== 10) return null;
  const h = hashRecovery(code);
  const list = Array.isArray(hashes) ? hashes : [];
  if (!list.includes(h)) return null;
  return list.filter((x) => x !== h);
}

// Kolom user yang dikosongkan saat 2FA dimatikan atau direset admin
export const TOTP_OFF = { totp_enabled: false, totp_secret: null, totp_recovery: null, totp_last_step: null };
