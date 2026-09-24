import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { recordAudit, diffFields, snapshotFields } from "../lib/audit.js";
import { simpleLimiter } from "../lib/ratelimit.js";
import { decorateSchedules, decorateSchedule, shapeShift, isValidTimezone } from "../lib/oncall.js";
import { acknowledge, escalationForIncident, stopReasonText } from "../lib/escalation.js";

export const oncallRouter = Router();
oncallRouter.use(requireAuth);

const MAX_STEPS = 10;
const MAX_DELAY_MINUTES = 7 * 24 * 60; // seminggu; lebih dari ini bukan eskalasi lagi
const TARGETS = ["oncall", "channel"];

// --- Jadwal rotasi ---

function validateSchedule(body) {
  const errors = [];
  const name = String(body.name || "").trim();
  if (!name) errors.push("Nama jadwal wajib diisi");
  const timezone = String(body.timezone || "Asia/Jakarta").trim();
  if (!isValidTimezone(timezone)) errors.push(`Zona waktu tidak dikenal: ${timezone}`);
  return {
    errors,
    data: {
      name: name.slice(0, 120),
      description: body.description ? String(body.description).slice(0, 500) : null,
      timezone,
      active: body.active === undefined ? true : !!body.active,
    },
  };
}

oncallRouter.get("/schedules", async (req, res) => {
  const rows = await prisma.onCallSchedule.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  res.json(await decorateSchedules(rows));
});

oncallRouter.post("/schedules", requireAdmin, async (req, res) => {
  const { errors, data } = validateSchedule(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  const created = await prisma.onCallSchedule.create({ data });
  recordAudit(req, {
    action: "oncall_schedule.create", entity: "oncall_schedule", entityId: created.id, entityName: created.name,
    summary: `Jadwal on-call "${created.name}" dibuat`, changes: snapshotFields(data),
  });
  res.status(201).json(await decorateSchedule(created));
});

oncallRouter.put("/schedules/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.onCallSchedule.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Jadwal tidak ditemukan" });
  const { errors, data } = validateSchedule({ ...existing, ...req.body });
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  const updated = await prisma.onCallSchedule.update({ where: { id }, data });
  recordAudit(req, {
    action: "oncall_schedule.update", entity: "oncall_schedule", entityId: id, entityName: updated.name,
    summary: `Jadwal on-call "${updated.name}" diubah`, changes: diffFields(existing, data),
  });
  res.json(await decorateSchedule(updated));
});

oncallRouter.delete("/schedules/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.onCallSchedule.findUnique({ where: { id } });
  if (!existing) return res.json({ ok: true });
  // Langkah eskalasi yang menunjuk jadwal ini ikut terhapus (cascade), jadi
  // admin diberi tahu dulu berapa yang terdampak.
  await prisma.onCallSchedule.delete({ where: { id } });
  recordAudit(req, {
    action: "oncall_schedule.delete", entity: "oncall_schedule", entityId: id, entityName: existing.name,
    summary: `Jadwal on-call "${existing.name}" dihapus`,
  });
  res.json({ ok: true });
});

// --- Shift ---

function validateShift(body, scheduleId) {
  const errors = [];
  const start = new Date(body.start_at);
  const end = new Date(body.end_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) errors.push("Waktu mulai/selesai tidak valid");
  else if (end <= start) errors.push("Waktu selesai harus setelah mulai");
  const userId = Number(body.user_id);
  if (!Number.isFinite(userId)) errors.push("User wajib dipilih");
  return {
    errors,
    data: {
      schedule_id: scheduleId,
      user_id: userId,
      start_at: start,
      end_at: end,
      note: body.note ? String(body.note).slice(0, 300) : null,
    },
  };
}

// ?from=&to= membatasi rentang yang diambil; tanpa itu, 60 hari ke belakang
// sampai 90 hari ke depan — cukup untuk kalender di UI tanpa menarik semuanya.
oncallRouter.get("/schedules/:id/shifts", async (req, res) => {
  const scheduleId = Number(req.params.id);
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 60 * 86400_000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 90 * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ error: "Rentang waktu tidak valid" });
  }
  const rows = await prisma.onCallShift.findMany({
    // Shift yang bertindihan dengan rentang, bukan hanya yang mulai di dalamnya
    where: { schedule_id: scheduleId, start_at: { lt: to }, end_at: { gt: from } },
    include: { user: { select: { id: true, username: true, oncall_notification_id: true, oncall_notification: { select: { id: true, name: true, type: true } } } } },
    orderBy: [{ start_at: "asc" }, { id: "asc" }],
    take: 500,
  });
  res.json(rows.map(shapeShift));
});

oncallRouter.post("/schedules/:id/shifts", requireAdmin, async (req, res) => {
  const scheduleId = Number(req.params.id);
  const schedule = await prisma.onCallSchedule.findUnique({ where: { id: scheduleId } });
  if (!schedule) return res.status(404).json({ error: "Jadwal tidak ditemukan" });
  const { errors, data } = validateShift(req.body || {}, scheduleId);
  if (!(await prisma.user.findUnique({ where: { id: data.user_id || 0 } }))) errors.push("User tidak ditemukan");
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });

  const created = await prisma.onCallShift.create({ data, include: { user: { select: { id: true, username: true, oncall_notification_id: true, oncall_notification: { select: { id: true, name: true, type: true } } } } } });
  recordAudit(req, {
    action: "oncall_shift.create", entity: "oncall_schedule", entityId: scheduleId, entityName: schedule.name,
    summary: `Shift ${created.user.username} ditambahkan ke "${schedule.name}"`, changes: snapshotFields(data),
  });
  res.status(201).json(shapeShift(created));
});

oncallRouter.delete("/shifts/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.onCallShift.findUnique({ where: { id }, include: { user: { select: { username: true } }, schedule: { select: { id: true, name: true } } } });
  if (!existing) return res.json({ ok: true });
  await prisma.onCallShift.delete({ where: { id } });
  recordAudit(req, {
    action: "oncall_shift.delete", entity: "oncall_schedule", entityId: existing.schedule.id, entityName: existing.schedule.name,
    summary: `Shift ${existing.user.username} dihapus dari "${existing.schedule.name}"`,
  });
  res.json({ ok: true });
});

// Siapa yang sedang bertugas di seluruh jadwal aktif — untuk kartu di dashboard
oncallRouter.get("/current", async (req, res) => {
  const rows = await prisma.onCallSchedule.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const decorated = await decorateSchedules(rows);
  res.json(decorated.map((s) => ({ id: s.id, name: s.name, timezone: s.timezone, current: s.current, next: s.next })));
});

// --- Escalation policy ---

// Langkah dikirim sebagai satu daftar utuh, bukan satu per satu: policy hanya
// masuk akal dibaca sebagai urutan, dan penyuntingannya pun per urutan.
async function validateSteps(input) {
  const errors = [];
  if (!Array.isArray(input)) return { errors: ["Daftar tingkat wajib berupa array"], steps: [] };
  if (input.length === 0) errors.push("Policy harus punya minimal satu tingkat");
  if (input.length > MAX_STEPS) errors.push(`Maksimal ${MAX_STEPS} tingkat per policy`);

  const raw = input.slice(0, MAX_STEPS);
  const scheduleIds = new Set((await prisma.onCallSchedule.findMany({ select: { id: true } })).map((s) => s.id));
  const notificationIds = new Set((await prisma.notification.findMany({ select: { id: true } })).map((n) => n.id));

  const steps = raw.map((s, i) => {
    const target = TARGETS.includes(s.target) ? s.target : "oncall";
    const delay = Number(s.delay_minutes);
    if (!Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_MINUTES) {
      errors.push(`Tingkat ${i + 1}: jeda harus 0–${MAX_DELAY_MINUTES} menit`);
    }
    const scheduleId = target === "oncall" ? Number(s.schedule_id) : null;
    const notificationId = target === "channel" ? Number(s.notification_id) : null;
    if (target === "oncall" && !scheduleIds.has(scheduleId)) errors.push(`Tingkat ${i + 1}: jadwal on-call tidak ditemukan`);
    if (target === "channel" && !notificationIds.has(notificationId)) errors.push(`Tingkat ${i + 1}: notifikasi tidak ditemukan`);
    return {
      step_order: i + 1,
      delay_minutes: Number.isFinite(delay) ? Math.max(0, Math.min(MAX_DELAY_MINUTES, Math.round(delay))) : 0,
      target,
      schedule_id: scheduleId,
      notification_id: notificationId,
    };
  });

  // Jeda menaik: tingkat yang jatuh tempo lebih dulu tapi ditulis belakangan
  // hampir selalu salah ketik, dan urutannya jadi tidak terbaca di UI.
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].delay_minutes < steps[i - 1].delay_minutes) {
      errors.push("Jeda tiap tingkat harus sama atau lebih lama dari tingkat sebelumnya");
      break;
    }
  }
  return { errors, steps };
}

const policyInclude = {
  steps: {
    orderBy: [{ step_order: "asc" }],
    include: {
      schedule: { select: { id: true, name: true } },
      notification: { select: { id: true, name: true, type: true } },
    },
  },
  _count: { select: { monitors: true } },
};

const shapePolicy = (p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  is_default: p.is_default,
  active: p.active,
  created_at: p.created_at,
  monitor_count: p._count?.monitors ?? 0,
  steps: (p.steps || []).map((s) => ({
    id: s.id,
    step_order: s.step_order,
    delay_minutes: s.delay_minutes,
    target: s.target,
    schedule: s.schedule || null,
    notification: s.notification || null,
  })),
});

oncallRouter.get("/policies", async (req, res) => {
  const rows = await prisma.escalationPolicy.findMany({
    include: policyInclude,
    orderBy: [{ is_default: "desc" }, { name: "asc" }],
  });
  res.json(rows.map(shapePolicy));
});

// Hanya satu policy yang boleh jadi default; menandai yang baru mencabut yang lama
async function clearOtherDefaults(keepId) {
  await prisma.escalationPolicy.updateMany({
    where: { is_default: true, ...(keepId ? { id: { not: keepId } } : {}) },
    data: { is_default: false },
  });
}

oncallRouter.post("/policies", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const { errors, steps } = await validateSteps(body.steps);
  if (!name) errors.unshift("Nama policy wajib diisi");
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });

  const isDefault = !!body.is_default;
  if (isDefault) await clearOtherDefaults(null);
  const created = await prisma.escalationPolicy.create({
    data: {
      name: name.slice(0, 120),
      description: body.description ? String(body.description).slice(0, 500) : null,
      is_default: isDefault,
      active: body.active === undefined ? true : !!body.active,
      steps: { create: steps },
    },
    include: policyInclude,
  });
  recordAudit(req, {
    action: "escalation_policy.create", entity: "escalation_policy", entityId: created.id, entityName: created.name,
    summary: `Escalation policy "${created.name}" dibuat dengan ${steps.length} tingkat`,
  });
  res.status(201).json(shapePolicy(created));
});

oncallRouter.put("/policies/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.escalationPolicy.findUnique({ where: { id }, include: { steps: true } });
  if (!existing) return res.status(404).json({ error: "Policy tidak ditemukan" });

  const body = req.body || {};
  const name = body.name === undefined ? existing.name : String(body.name).trim();
  if (!name) return res.status(400).json({ error: "Nama policy wajib diisi" });

  // Daftar tingkat hanya disentuh kalau dikirim
  let steps = null;
  if (body.steps !== undefined) {
    const v = await validateSteps(body.steps);
    if (v.errors.length) return res.status(400).json({ error: v.errors.join(", ") });
    steps = v.steps;
  }

  const data = {
    name: name.slice(0, 120),
    description: body.description === undefined ? existing.description : body.description ? String(body.description).slice(0, 500) : null,
    is_default: body.is_default === undefined ? existing.is_default : !!body.is_default,
    active: body.active === undefined ? existing.active : !!body.active,
  };
  if (data.is_default) await clearOtherDefaults(id);

  const updated = await prisma.escalationPolicy.update({
    where: { id },
    data: steps ? { ...data, steps: { deleteMany: {}, create: steps } } : data,
    include: policyInclude,
  });
  recordAudit(req, {
    action: "escalation_policy.update", entity: "escalation_policy", entityId: id, entityName: updated.name,
    summary: `Escalation policy "${updated.name}" diubah`,
    changes: diffFields(existing, data),
  });
  res.json(shapePolicy(updated));
});

oncallRouter.delete("/policies/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.escalationPolicy.findUnique({ where: { id } });
  if (!existing) return res.json({ ok: true });
  // Monitor yang memakainya kembali ke policy default (SetNull di schema)
  await prisma.escalationPolicy.delete({ where: { id } });
  recordAudit(req, {
    action: "escalation_policy.delete", entity: "escalation_policy", entityId: id, entityName: existing.name,
    summary: `Escalation policy "${existing.name}" dihapus`,
  });
  res.json({ ok: true });
});

// Rantai eskalasi satu incident — dipakai halaman detail monitor
oncallRouter.get("/escalations/:incidentId", async (req, res) => {
  const esc = await escalationForIncident(req.params.incidentId);
  if (!esc) return res.status(404).json({ error: "Incident ini tidak punya rantai eskalasi" });
  res.json(esc);
});

// Ack dari UI oleh admin yang sudah login
oncallRouter.post("/escalations/:incidentId/ack", requireAdmin, async (req, res) => {
  const result = await acknowledge({ incidentId: req.params.incidentId }, req.user?.username || "admin");
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  if (!result.already) {
    recordAudit(req, {
      action: "escalation.acknowledge", entity: "incident", entityId: Number(req.params.incidentId),
      entityName: result.escalation?.monitor?.name,
      summary: `Eskalasi incident #${req.params.incidentId} di-acknowledge`,
    });
  }
  res.json({ ok: true, already: !!result.already, escalation: await escalationForIncident(req.params.incidentId) });
});

// --- Acknowledge lewat tautan di pesan notifikasi (tanpa login) ---

export const ackRouter = Router();

// Selonggar endpoint push: cukup untuk dipakai manusia, tetap berbatas.
ackRouter.use(simpleLimiter({ max: 60, windowSeconds: 60, prefix: "ack" }));

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function ackPage({ title, message, token, showButton }) {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Pulsewatch</title>
<style>
  :root { color-scheme: dark light }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0f172a; color:#e2e8f0;
         font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; padding:24px }
  .card { max-width:420px; width:100%; background:#1e293b; border:1px solid #334155; border-radius:14px; padding:28px }
  h1 { margin:0 0 12px; font-size:20px }
  p { margin:0 0 20px; color:#94a3b8 }
  button { width:100%; padding:12px 16px; font-size:16px; font-weight:600; cursor:pointer;
           background:#38bdf8; color:#0f172a; border:0; border-radius:10px }
  button:disabled { opacity:.6; cursor:default }
</style></head>
<body><div class="card">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  ${showButton ? `<button id="ack">Saya tangani</button>
  <script>
    // Ack sengaja butuh satu klik, bukan langsung jalan saat halaman dibuka:
    // aplikasi chat sering memuat pratinjau tautan dengan GET, dan itu tidak
    // boleh terhitung sebagai "sudah ditangani".
    const btn = document.getElementById("ack");
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Mengirim…";
      const res = await fetch(location.pathname, { method: "POST" }).then(r => r.json()).catch(() => null);
      btn.textContent = res && res.ok ? "Tercatat — terima kasih" : (res && res.error) || "Gagal, coba lagi";
    };
  </script>` : ""}
</div></body></html>`;
}

const TOKEN_RE = /^[a-f0-9]{48}$/;

// GET hanya menampilkan konfirmasi; yang meng-ack adalah POST dari tombolnya.
ackRouter.get("/:token", async (req, res) => {
  const token = String(req.params.token || "");
  res.type("html");
  if (!TOKEN_RE.test(token)) return res.status(404).send(ackPage({ title: "Tautan tidak dikenal", message: "Tautan acknowledge ini tidak berlaku." }));

  const esc = await prisma.escalation.findUnique({
    where: { ack_token: token },
    include: { monitor: { select: { name: true } } },
  });
  if (!esc) return res.status(404).send(ackPage({ title: "Tautan tidak dikenal", message: "Tautan acknowledge ini tidak berlaku." }));

  const name = esc.monitor?.name || `monitor #${esc.monitor_id}`;
  if (esc.acknowledged_at) {
    return res.send(ackPage({ title: "Sudah ditangani", message: `${name} sudah di-acknowledge oleh ${esc.acknowledged_by || "seseorang"}.` }));
  }
  if (esc.stopped_at && esc.stopped_reason !== "exhausted") {
    return res.send(ackPage({ title: "Eskalasi sudah berhenti", message: `Eskalasi ${name} berhenti karena ${stopReasonText(esc.stopped_reason)}.` }));
  }
  res.send(ackPage({
    title: `${name} masih DOWN`,
    message: "Menekan tombol di bawah menghentikan sisa tingkat eskalasi dan mencatat bahwa gangguan ini sedang ditangani.",
    token, showButton: true,
  }));
});

ackRouter.post("/:token", async (req, res) => {
  const token = String(req.params.token || "");
  if (!TOKEN_RE.test(token)) return res.status(404).json({ error: "Tautan acknowledge tidak berlaku" });
  // Tanpa login, pelakunya tidak bisa dipastikan — dicatat apa adanya
  const result = await acknowledge({ token }, "tautan notifikasi");
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json({ ok: true, already: !!result.already });
});
