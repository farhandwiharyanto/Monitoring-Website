import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { emitMonitorEvent } from "../scheduler.js";

// Webhook inbound: sistem luar (Ansible, n8n, runbook sendiri) melapor bahwa
// suatu aksi otomatis sudah dijalankan. Dicatat sebagai event pada timeline
// monitor — bukan heartbeat, jadi tidak mengubah status maupun uptime.
export const webhookRouter = Router();
webhookRouter.use(requireAuth); // API key scope write, atau admin yang login

const KINDS = ["automation", "note"];
const MAX_PAYLOAD_BYTES = 8000;

// Memotong string JSON akan merusak strukturnya, jadi body yang kelewat besar
// diganti penanda alih-alih disimpan separuh.
function safePayload(body) {
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) return null;
  try {
    const json = JSON.stringify(body);
    if (json.length <= MAX_PAYLOAD_BYTES) return body;
    return { _truncated: true, _size_bytes: json.length, keys: Object.keys(body).slice(0, 50) };
  } catch {
    return { _unserializable: true };
  }
}

webhookRouter.post("/trigger/:monitorId", async (req, res) => {
  const monitorId = Number(req.params.monitorId);
  if (!Number.isFinite(monitorId)) return res.status(400).json({ error: "monitorId tidak valid" });

  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId }, select: { id: true, name: true } });
  if (!monitor) return res.status(404).json({ error: "Monitor tidak ditemukan" });

  const body = req.body || {};
  const title = String(body.title || body.action || "Aksi otomatis dijalankan").trim().slice(0, 200);
  const message = body.message ? String(body.message).slice(0, 1000) : null;
  const kind = KINDS.includes(body.kind) ? body.kind : "automation";
  // Sumber diambil dari body, atau nama API key yang dipakai
  const source = String(body.source || req.user?.username || "external").slice(0, 80);

  // Tautkan ke incident yang sedang terbuka, bila ada, supaya muncul
  // pada timeline incident tersebut.
  const open = await prisma.incident.findFirst({
    where: { monitor_id: monitorId, resolved_at: null },
    orderBy: { id: "desc" },
    select: { id: true },
  });

  const event = await prisma.monitorEvent.create({
    data: {
      monitor_id: monitorId,
      incident_id: open?.id ?? null,
      kind, source, title, message,
      // Simpan body asli untuk penelusuran; body yang terlalu besar diringkas
      // agar tidak membebani database.
      payload: safePayload(body),
    },
  });

  emitMonitorEvent(monitorId, event);
  res.status(201).json({ ok: true, event, incident_id: open?.id ?? null });
});

// Timeline event sebuah monitor
webhookRouter.get("/events/:monitorId", async (req, res) => {
  const monitorId = Number(req.params.monitorId);
  const take = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(
    await prisma.monitorEvent.findMany({ where: { monitor_id: monitorId }, orderBy: { created_at: "desc" }, take })
  );
});
