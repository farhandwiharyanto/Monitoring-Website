import { prisma } from "../db.js";
import { clientIp } from "./ratelimit.js";

// Field yang nilainya tidak boleh masuk audit log apa adanya. Yang dicatat
// hanya "berubah dari terisi ke terisi", bukan isinya.
const SECRET_FIELDS = new Set([
  "password", "password_hash", "currentPassword", "newPassword",
  "auth_secret", "auth_password", "auth_token",
  "push_token", "key_hash", "token",
  "config", "http_headers", "action_webhook_headers",
]);

const MASK = "•••";
const MAX_CHANGED_FIELDS = 40;
const MAX_VALUE_LENGTH = 200;

// Field teknis yang berubah sendiri dan tidak menarik untuk dibaca manusia
const NOISE_FIELDS = new Set(["updated_at", "created_at", "id", "last_used_at", "cert_checked_at", "cert_notified_threshold"]);

function readable(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value).slice(0, MAX_VALUE_LENGTH);
  if (typeof value === "string") return value.slice(0, MAX_VALUE_LENGTH);
  return value;
}

const comparable = (v) => JSON.stringify(readable(v) ?? null);

// Beda antara keadaan sebelum & sesudah, hanya untuk field yang dikirim pada
// `after`. Nilai rahasia diganti penanda, bukan dibuang, supaya tetap terlihat
// bahwa field itu ikut diubah.
export function diffFields(before, after, { skip = [] } = {}) {
  const changes = {};
  for (const key of Object.keys(after || {})) {
    if (NOISE_FIELDS.has(key) || skip.includes(key)) continue;
    if (comparable(before?.[key]) === comparable(after[key])) continue;
    if (Object.keys(changes).length >= MAX_CHANGED_FIELDS) break;

    changes[key] = SECRET_FIELDS.has(key)
      ? { from: before?.[key] ? MASK : null, to: after[key] ? MASK : null }
      : { from: readable(before?.[key]), to: readable(after[key]) };
  }
  return Object.keys(changes).length ? changes : null;
}

// Seluruh isi satu entitas sebagai "changes" — dipakai saat membuat atau menghapus,
// waktu mana tidak ada pembanding.
export const snapshotFields = (row, opts) => diffFields({}, row || {}, opts);

// Siapa yang melakukan: user yang login, API key, atau permintaan tanpa auth.
// Endpoint login belum punya req.user saat mencatat, jadi pemanggil boleh
// menyebutkan pelakunya sendiri lewat actorFallback/actorType/actorId.
function actorOf(req, { actorFallback, actorType, actorId } = {}) {
  if (req?.apiKey) return { actor: `apikey:${req.apiKey.label}`, actor_type: "apikey", actor_id: null };
  if (req?.user?.username) return { actor: req.user.username, actor_type: "user", actor_id: req.user.id ?? null };
  return {
    actor: actorFallback || "anonim",
    // Tanpa fallback berarti permintaan datang tanpa identitas sama sekali
    actor_type: actorType || (actorFallback ? "user" : "anonymous"),
    actor_id: actorId ?? null,
  };
}

// Catat satu kejadian. Sengaja tidak di-await di pemanggil: kegagalan menulis
// audit tidak boleh menggagalkan tindakan yang sudah berhasil dijalankan.
export function recordAudit(req, { action, entity, entityId, entityName, summary, changes, actorFallback, actorType, actorId }) {
  return prisma.auditLog
    .create({
      data: {
        ...actorOf(req, { actorFallback, actorType, actorId }),
        action,
        entity,
        entity_id: entityId ?? null,
        entity_name: entityName ? String(entityName).slice(0, 200) : null,
        summary: summary ? String(summary).slice(0, 500) : null,
        changes: changes ?? undefined,
        ip: req ? clientIp(req) : null,
      },
    })
    .catch((err) => console.error("[audit] gagal mencatat:", err.message));
}
