import { Router } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireAdmin, denyApiKey } from "../lib/auth.js";
import { generateKey, publicApiKey, SCOPES } from "../lib/apikey.js";
import { recordAudit } from "../lib/audit.js";

// Manajemen API key: admin yang login saja. Sebuah API key tidak boleh
// membuat atau mencabut API key lain (pencegahan eskalasi hak akses).
export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth, denyApiKey, requireAdmin);

apiKeysRouter.get("/", async (req, res) => {
  const rows = await prisma.apiKey.findMany({ orderBy: [{ revoked_at: "asc" }, { created_at: "desc" }] });
  res.json({
    keys: rows.map(publicApiKey),
    rate_limit: { max_requests: config.apiKeyMaxRequests, window_seconds: config.apiKeyWindowSeconds },
  });
});

apiKeysRouter.post("/", async (req, res) => {
  const label = String(req.body?.label || "").trim().slice(0, 80);
  const scope = SCOPES.includes(req.body?.scope) ? req.body.scope : "read";
  if (!label) return res.status(400).json({ error: "Label wajib diisi" });

  const { key, key_hash, prefix } = generateKey();
  const row = await prisma.apiKey.create({
    data: { label, scope, key_hash, prefix, created_by: req.user.username },
  });

  recordAudit(req, {
    action: "api_key.create", entity: "api_key", entityId: row.id, entityName: row.label,
    summary: `API key "${row.label}" (${row.scope}) dibuat, prefix ${row.prefix}`,
  });
  // Satu-satunya kesempatan melihat kunci penuh — setelah ini hanya hash yang tersimpan
  res.status(201).json({ ...publicApiKey(row), key });
});

// Cabut, bukan hapus: riwayat pemakaian tetap bisa ditelusuri
apiKeysRouter.post("/:id/revoke", async (req, res) => {
  const id = Number(req.params.id);
  const row = await prisma.apiKey.findUnique({ where: { id } });
  if (!row) return res.status(404).json({ error: "API key tidak ditemukan" });
  if (row.revoked_at) return res.json(publicApiKey(row));
  const revoked = await prisma.apiKey.update({ where: { id }, data: { revoked_at: new Date() } });
  recordAudit(req, {
    action: "api_key.revoke", entity: "api_key", entityId: id, entityName: row.label,
    summary: `API key "${row.label}" (${row.scope}) dicabut`,
  });
  res.json(publicApiKey(revoked));
});

apiKeysRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.apiKey.findUnique({ where: { id } });
  await prisma.apiKey.delete({ where: { id } }).catch(() => {});
  if (existing) {
    recordAudit(req, {
      action: "api_key.delete", entity: "api_key", entityId: id, entityName: existing.label,
      summary: `API key "${existing.label}" dihapus dari daftar`,
    });
  }
  res.json({ ok: true });
});
