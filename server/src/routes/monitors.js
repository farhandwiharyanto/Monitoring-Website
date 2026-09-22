import { Router } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, findMonitor, dashboardStats, monitorInclude, knownLocations } from "../lib/stats.js";
import { scheduleNow, unschedule, checkCertificateNow, locationFilter } from "../scheduler.js";
import { runCheck, MONITOR_TYPES } from "../checks/index.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";  // decryptSecret: mempertahankan password lama saat edit
import { ASSERTION_OPERATORS, operatorNeedsValue, parsePath, describeAssertion } from "../lib/assertion.js";
import { newPushToken } from "./push.js";
import { upsertTags } from "./tags.js";

export const monitorsRouter = Router();
monitorsRouter.use(requireAuth);

const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "SRV"];
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const AUTH_TYPES = ["none", "basic", "bearer"];
const MAX_HEADERS = 20;

// Header kontrol transport tidak boleh diatur dari UI
const BLOCKED_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade"]);

// Terima object {nama: nilai} maupun array [{key, value}] dari form
function cleanHeaders(input, errors) {
  if (input === undefined || input === null || input === "") return undefined;
  const pairs = Array.isArray(input)
    ? input.map((h) => [h?.key, h?.value])
    : typeof input === "object"
      ? Object.entries(input)
      : null;
  if (!pairs) { errors.push("Custom header harus berupa object atau array"); return undefined; }

  const out = {};
  for (const [rawKey, rawValue] of pairs) {
    const key = String(rawKey ?? "").trim();
    if (!key) continue;
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) { errors.push(`Nama header tidak valid: ${key}`); continue; }
    if (BLOCKED_HEADERS.has(key.toLowerCase())) { errors.push(`Header "${key}" diatur otomatis dan tidak bisa ditimpa`); continue; }
    if (Object.keys(out).length >= MAX_HEADERS) { errors.push(`Maksimal ${MAX_HEADERS} custom header`); break; }
    out[key] = String(rawValue ?? "").slice(0, 2048);
  }
  return Object.keys(out).length ? out : null;
}

// Kembalikan nilai auth_secret baru, atau undefined kalau tidak perlu diubah
function resolveAuthSecret(body, existing, authType, errors) {
  if (authType === "none") return existing?.auth_secret ? null : undefined;

  if (authType === "basic") {
    const username = body.auth_username !== undefined ? String(body.auth_username).trim() : null;
    const password = body.auth_password !== undefined ? String(body.auth_password) : null;
    // Form mengirim password kosong saat tidak diubah — pertahankan yang lama
    if (username === null && password === null) {
      if (!existing?.auth_secret) errors.push("Basic Auth butuh username dan password");
      return undefined;
    }
    const prev = decryptSecret(existing?.auth_secret) || "";
    const prevUser = prev.includes(":") ? prev.slice(0, prev.indexOf(":")) : "";
    const prevPass = prev.includes(":") ? prev.slice(prev.indexOf(":") + 1) : "";
    const finalUser = username || prevUser;
    const finalPass = password || prevPass;
    if (!finalUser || !finalPass) { errors.push("Basic Auth butuh username dan password"); return undefined; }
    if (finalUser.includes(":")) { errors.push("Username Basic Auth tidak boleh mengandung titik dua"); return undefined; }
    return encryptSecret(`${finalUser}:${finalPass}`);
  }

  // bearer
  const token = body.auth_token !== undefined ? String(body.auth_token).trim() : null;
  if (!token) {
    if (!existing?.auth_secret) errors.push("Bearer auth butuh token");
    return undefined;
  }
  return encryptSecret(token);
}

// assertion_path/operator/value divalidasi bersama agar tidak setengah terisi
function cleanAssertion(body, errors) {
  const path = body.assertion_path !== undefined ? String(body.assertion_path || "").trim() : undefined;
  const operator = body.assertion_operator !== undefined ? String(body.assertion_operator || "").trim() : undefined;
  if (path === undefined && operator === undefined && body.assertion_value === undefined) return {};

  if (!path && !operator) return { assertion_path: null, assertion_operator: null, assertion_value: null };
  if (!path || !operator) { errors.push("Assertion butuh path dan operator sekaligus"); return {}; }
  if (!ASSERTION_OPERATORS.includes(operator)) { errors.push(`Operator assertion tidak dikenal: ${operator}`); return {}; }
  try { parsePath(path); } catch (err) { errors.push(`Path assertion tidak valid: ${err.message}`); return {}; }

  const needsValue = operatorNeedsValue(operator);
  const value = body.assertion_value !== undefined ? String(body.assertion_value) : "";
  if (needsValue && value === "") { errors.push(`Operator "${operator}" butuh nilai pembanding`); return {}; }
  return { assertion_path: path.slice(0, 255), assertion_operator: operator, assertion_value: needsValue ? value.slice(0, 500) : null };
}

// push_token adalah kredensial: hanya admin yang boleh melihatnya, dan selalu
// dikirim bersama URL siap pakai supaya gampang disalin.
function shape(monitor, user) {
  if (!monitor) return monitor;
  const isAdmin = user?.role === "admin";
  // auth_secret sudah dibuang decorateMonitors; di sini hanya username Basic Auth
  // yang dibuka kembali agar form bisa menampilkannya. Password/token tidak pernah keluar.
  const { push_token, auth_secret, auth_username, ...rest } = monitor;
  const out = { ...rest, assertion_summary: describeAssertion(monitor) };

  // Username Basic Auth hanya untuk admin yang mengedit monitor
  if (isAdmin) out.auth_username = auth_username ?? null;

  if (monitor.type !== "push") return out;
  if (!isAdmin) return { ...out, push_url: null };
  return { ...out, push_token, push_url: push_token ? `${config.baseUrl}/api/push/${push_token}` : null };
}

function validate(body, existing = null) {
  const errors = [];
  const type = MONITOR_TYPES.includes(body.type) ? body.type : "http";
  const m = {
    name: String(body.name || "").trim().slice(0, 120),
    type,
    url: body.url ? String(body.url).trim().slice(0, 2048) : null,
    hostname: body.hostname ? String(body.hostname).trim().slice(0, 253) : null,
    port: body.port ? Number(body.port) : null,
    dns_resolve_type: DNS_TYPES.includes(String(body.dns_resolve_type || "").toUpperCase()) ? String(body.dns_resolve_type).toUpperCase() : "A",
    dns_expected: body.dns_expected ? String(body.dns_expected).slice(0, 255) : null,
    method: HTTP_METHODS.includes(String(body.method || "").toUpperCase()) ? String(body.method).toUpperCase() : "GET",
    interval_seconds: Math.min(86400, Math.max(10, Number(body.interval_seconds) || 60)),
    timeout_seconds: Math.min(300, Math.max(1, Number(body.timeout_seconds) || 30)),
    max_retries: Math.min(10, Math.max(0, Number(body.max_retries) || 0)),
    expected_status_codes: String(body.expected_status_codes || "200-299").slice(0, 100),
    keyword: body.keyword ? String(body.keyword).slice(0, 255) : null,
    active: body.active === undefined ? true : !!body.active,
    push_grace_seconds: Math.min(86400, Math.max(0, Number(body.push_grace_seconds ?? 60))),
    check_cert: body.check_cert === undefined ? true : !!body.check_cert,
    auth_type: AUTH_TYPES.includes(body.auth_type) ? body.auth_type : "none",
  };

  // Header kustom, kredensial, dan assertion hanya relevan untuk HTTP
  if (m.type === "http") {
    const headers = cleanHeaders(body.http_headers, errors);
    if (headers !== undefined) m.http_headers = headers;

    const secret = resolveAuthSecret(body, existing, m.auth_type, errors);
    if (secret !== undefined) m.auth_secret = secret;

    Object.assign(m, cleanAssertion(body, errors));
  } else {
    // Ganti tipe dari http: bersihkan sisa konfigurasi yang tidak berlaku lagi
    m.auth_type = "none";
    m.auth_secret = null;
    m.http_headers = null;
    m.assertion_path = null;
    m.assertion_operator = null;
    m.assertion_value = null;
  }

  if (!m.name) errors.push("Nama wajib diisi");
  // Monitor push tidak melakukan koneksi keluar, jadi timeout-nya tidak dipakai
  if (m.type !== "push" && m.timeout_seconds > m.interval_seconds) {
    errors.push("Timeout tidak boleh lebih besar dari interval");
  }

  if (m.type === "http") {
    let parsed;
    try { parsed = new URL(m.url || ""); } catch { parsed = null; }
    if (!parsed || !/^https?:$/.test(parsed.protocol)) errors.push("URL harus diawali http:// atau https://");
    if (!/^\s*(\d{3}(\s*-\s*\d{3})?)(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/.test(m.expected_status_codes)) {
      errors.push("Format status code tidak valid (contoh: 200-299 atau 200,301)");
    }
  } else if (m.type === "push") {
    // Tidak butuh target: heartbeat datang dari luar
  } else if (!m.hostname) {
    errors.push("Hostname wajib diisi");
  }
  if (m.type === "tcp" && !(m.port > 0 && m.port < 65536)) errors.push("Port tidak valid");

  return { m, errors };
}

// Relasi notifikasi & tag: hanya disentuh kalau field dikirim (null = biarkan)
async function syncRelations(monitorId, body) {
  if (Array.isArray(body.notification_ids)) {
    const valid = await prisma.notification.findMany({
      where: { id: { in: body.notification_ids.map(Number).filter(Number.isFinite) } },
      select: { id: true },
    });
    await prisma.monitorNotification.deleteMany({ where: { monitor_id: monitorId } });
    await prisma.monitorNotification.createMany({
      data: valid.map((n) => ({ monitor_id: monitorId, notification_id: n.id })),
      skipDuplicates: true,
    });
  }
  const tagIds = await upsertTags(body.tags);
  if (tagIds) {
    await prisma.monitorTag.deleteMany({ where: { monitor_id: monitorId } });
    await prisma.monitorTag.createMany({ data: tagIds.map((tag_id) => ({ monitor_id: monitorId, tag_id })), skipDuplicates: true });
  }
}

// GET /api/monitors?tag=nama  → list (opsional filter tag)
monitorsRouter.get("/", async (req, res) => {
  const where = req.query.tag ? { tags: { some: { tag: { name: String(req.query.tag) } } } } : {};
  const rows = await prisma.monitor.findMany({ where, include: monitorInclude, orderBy: { name: "asc" } });
  res.json((await decorateMonitors(rows)).map((m) => shape(m, req.user)));
});

monitorsRouter.get("/stats", async (req, res) => res.json(await dashboardStats()));

// Lokasi agen yang aktif 7 hari terakhir — dipakai filter lokasi di dashboard.
// Didefinisikan sebelum "/:id" agar tidak tertangkap sebagai id monitor.
monitorsRouter.get("/locations", async (req, res) => res.json(await knownLocations()));

monitorsRouter.post("/", requireAdmin, async (req, res) => {
  const { m, errors } = validate(req.body, null);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  // Monitor push langsung diberi token; tipe lain tidak memerlukannya
  const created = await prisma.monitor.create({ data: { ...m, push_token: m.type === "push" ? newPushToken() : null } });
  await syncRelations(created.id, req.body);
  scheduleNow(created.id);
  res.status(201).json(shape(await findMonitor(created.id), req.user));
});

// Uji check sekali tanpa menyimpan (dipakai form "Test")
monitorsRouter.post("/test", requireAdmin, async (req, res) => {
  // Saat mengedit monitor yang sudah ada, password yang tidak diketik ulang
  // tetap dipakai dari yang tersimpan.
  const existing = req.body?.id ? await prisma.monitor.findUnique({ where: { id: Number(req.body.id) } }) : null;
  const { m, errors } = validate(req.body, existing);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  const result = await runCheck(m);
  res.json({ ...result, assertion_summary: describeAssertion(m) });
});

monitorsRouter.get("/:id", async (req, res) => {
  const m = await findMonitor(req.params.id, { beats: 50 });
  if (!m) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  res.json(shape(m, req.user));
});

monitorsRouter.put("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.monitor.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  const { m, errors } = validate({ ...existing, ...req.body }, existing);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  // Berganti tipe ke/dari push: token dibuat saat dibutuhkan, dibuang saat tidak
  const data = { ...m };
  if (m.type === "push" && !existing.push_token) data.push_token = newPushToken();
  if (m.type !== "push" && existing.push_token) data.push_token = null;
  await prisma.monitor.update({ where: { id }, data });
  await syncRelations(id, req.body);
  m.active ? scheduleNow(id) : unschedule(id);
  res.json(shape(await findMonitor(id), req.user));
});

monitorsRouter.post("/:id/pause", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.update({ where: { id }, data: { active: false } });
  unschedule(id);
  res.json(shape(await findMonitor(id), req.user));
});
monitorsRouter.post("/:id/resume", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.update({ where: { id }, data: { active: true } });
  scheduleNow(id);
  res.json(shape(await findMonitor(id), req.user));
});

// Token push bocor → buat ulang; URL lama langsung tidak berlaku
monitorsRouter.post("/:id/reset-push-token", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const monitor = await prisma.monitor.findUnique({ where: { id } });
  if (!monitor) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  if (monitor.type !== "push") return res.status(400).json({ error: "Hanya untuk monitor tipe push" });
  await prisma.monitor.update({ where: { id }, data: { push_token: newPushToken() } });
  scheduleNow(id);
  res.json(shape(await findMonitor(id), req.user));
});

// Periksa sertifikat TLS sekarang juga (di luar jadwal 6 jam)
monitorsRouter.post("/:id/cert", requireAdmin, async (req, res) => {
  const monitor = await prisma.monitor.findUnique({ where: { id: Number(req.params.id) } });
  if (!monitor) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  const info = await checkCertificateNow(monitor);
  if (!info.ok) return res.status(400).json({ error: info.error });
  res.json(info);
});

monitorsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.monitor.delete({ where: { id } }).catch(() => {});
  unschedule(id);
  res.json({ ok: true });
});

// Heartbeat history untuk grafik: ?hours=24
// ?hours=24 &location=<nama|all>. Tanpa parameter lokasi, dipakai lokasi primary
// supaya grafik tetap sama seperti sebelum multi-location ada.
monitorsRouter.get("/:id/heartbeats", async (req, res) => {
  const hours = Math.min(24 * 30, Math.max(1, Number(req.query.hours) || 24));
  const requested = req.query.location ? String(req.query.location) : null;
  const where = {
    monitor_id: Number(req.params.id),
    created_at: { gte: new Date(Date.now() - hours * 3600_000) },
  };
  if (requested !== "all") Object.assign(where, locationFilter(requested || config.primaryLocation));

  const rows = await prisma.heartbeat.findMany({
    where,
    orderBy: { created_at: "asc" },
    select: {
      id: true, status: true, message: true, response_time: true, important: true,
      maintenance: true, location: true, assertion_ok: true, assertion_message: true, created_at: true,
    },
  });
  res.json(rows);
});

monitorsRouter.get("/:id/incidents", async (req, res) => {
  res.json(await prisma.incident.findMany({ where: { monitor_id: Number(req.params.id) }, orderBy: { started_at: "desc" }, take: 100 }));
});

// Event penting (perubahan status) untuk list "Important events"
monitorsRouter.get("/:id/events", async (req, res) => {
  res.json(
    await prisma.heartbeat.findMany({ where: { monitor_id: Number(req.params.id), important: true }, orderBy: { created_at: "desc" }, take: 50 })
  );
});

// Maintenance window milik monitor ini
monitorsRouter.get("/:id/maintenance", async (req, res) => {
  const { decorateWindow } = await import("../lib/maintenance.js");
  const rows = await prisma.maintenanceWindow.findMany({ where: { monitor_id: Number(req.params.id) }, orderBy: [{ active: "desc" }, { start_at: "desc" }] });
  res.json(rows.map(decorateWindow));
});
