import { Router } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { decorateMonitors, findMonitor, dashboardStats, monitorInclude, knownLocations } from "../lib/stats.js";
import { scheduleNow, unschedule, checkCertificateNow, locationFilter } from "../scheduler.js";
import { runCheck, MONITOR_TYPES, DATABASE_TYPES } from "../checks/index.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";  // decryptSecret: mempertahankan password lama saat edit
import { ASSERTION_OPERATORS, operatorNeedsValue, parsePath, describeAssertion } from "../lib/assertion.js";
import { newPushToken } from "./push.js";
import { triggerActionWebhook } from "../lib/actionWebhook.js";
import { upsertTags } from "./tags.js";
import { wouldCycle, chainDepth, MAX_DEPTH, invalidateDependencyCache } from "../lib/dependency.js";
import { recordAudit, diffFields, snapshotFields } from "../lib/audit.js";
import { stopEscalation } from "../lib/escalation.js";
import { cleanRenotifyMinutes } from "../lib/renotify.js";
import { dailySeries } from "../lib/rollup.js";

export const monitorsRouter = Router();
monitorsRouter.use(requireAuth);

const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "SRV"];
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const AUTH_TYPES = ["none", "basic", "bearer"];
const ACTION_METHODS = ["POST", "GET", "PUT"];
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

// Konfigurasi webhook aksi: URL http(s), method terbatas, header aman
function cleanActionWebhook(body, errors) {
  const out = {};
  if (body.action_webhook_url !== undefined) {
    const raw = String(body.action_webhook_url || "").trim();
    if (!raw) out.action_webhook_url = null;
    else {
      let parsed;
      try { parsed = new URL(raw); } catch { parsed = null; }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) errors.push("URL webhook aksi harus diawali http:// atau https://");
      else out.action_webhook_url = raw.slice(0, 2048);
    }
  }
  if (body.action_webhook_method !== undefined) {
    const m = String(body.action_webhook_method || "POST").toUpperCase();
    if (!ACTION_METHODS.includes(m)) errors.push(`Method webhook aksi harus salah satu dari ${ACTION_METHODS.join(", ")}`);
    else out.action_webhook_method = m;
  }
  if (body.action_webhook_headers !== undefined) {
    const headers = cleanHeaders(body.action_webhook_headers, errors);
    if (headers !== undefined) out.action_webhook_headers = headers;
  }
  if (body.action_on_down !== undefined) out.action_on_down = !!body.action_on_down;
  if (body.action_on_recover !== undefined) out.action_on_recover = !!body.action_on_recover;
  return out;
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

// Target SLO dalam persen. Dibatasi 0–100 dan di bawah 100 persis: target 100%
// berarti error budget nol, yang tidak ada gunanya sebagai alat ukur.
function cleanSloTarget(body, errors) {
  if (body.slo_target === undefined) return config.sloDefaultTarget;
  if (body.slo_target === null || body.slo_target === "") return null;
  const n = Number(body.slo_target);
  if (!Number.isFinite(n)) { errors.push("Target SLO harus berupa angka"); return null; }
  if (n <= 0 || n >= 100) { errors.push("Target SLO harus di antara 0 dan 100 (mis. 99.9)"); return null; }
  // Empat angka di belakang koma sudah setara ~26 detik per bulan
  return Math.round(n * 10000) / 10000;
}

// Skema yang sah per tipe database. Dicek di depan supaya salah tempel
// connection string ketahuan saat menyimpan, bukan nanti saat check pertama.
const CONN_SCHEMES = {
  postgres: ["postgres://", "postgresql://"],
  mysql: ["mysql://"],
  oracle: ["oracle://"],
  mssql: ["mssql://"],
  redis: ["redis://", "rediss://"],
};

// Connection string diperlakukan seperti kredensial monitor lainnya: disimpan
// terenkripsi, dan form yang tidak mengirimnya berarti "jangan diubah" —
// sehingga mengedit monitor tanpa mengetik ulang password tetap bisa.
function resolveConnSecret(body, existing, type, errors) {
  if (body.conn_uri === undefined) {
    if (!existing?.conn_secret) errors.push("Connection string wajib diisi");
    return undefined;
  }
  const raw = String(body.conn_uri).trim();
  if (!raw) {
    // Kosong saat mengedit = pertahankan yang lama, sama seperti field password
    if (!existing?.conn_secret) errors.push("Connection string wajib diisi");
    return undefined;
  }
  const schemes = CONN_SCHEMES[type] || [];
  if (!schemes.some((prefix) => raw.toLowerCase().startsWith(prefix))) {
    errors.push(`Connection string ${type} harus diawali ${schemes.join(" atau ")}`);
    return undefined;
  }
  return encryptSecret(raw.slice(0, 2048));
}

// Opsi non-rahasia per tipe check. Hanya kunci yang dikenal yang disimpan,
// supaya kolom JSON ini tidak berubah jadi tempat menaruh apa saja.
function cleanCheckConfig(body, type, errors) {
  const input = body.check_config && typeof body.check_config === "object" && !Array.isArray(body.check_config) ? body.check_config : {};
  const out = {};
  if (type === "grpc") {
    const service = String(input.grpc_service ?? "").trim();
    if (service) out.grpc_service = service.slice(0, 200);
    // TLS menyala kecuali dimatikan eksplisit; layanan gRPC publik hampir
    // selalu memakai TLS, dan salah tebak ke arah aman lebih baik.
    if (input.grpc_tls === false) out.grpc_tls = false;
    return Object.keys(out).length ? out : null;
  }
  if (type === "kafka") {
    const brokers = String(input.kafka_brokers ?? "").trim();
    if (!brokers) errors.push("Daftar broker Kafka wajib diisi (host:port, dipisah koma)");
    else out.kafka_brokers = brokers.slice(0, 500);
    const topic = String(input.kafka_topic ?? "").trim();
    if (topic) out.kafka_topic = topic.slice(0, 250);
    if (input.kafka_ssl === true) out.kafka_ssl = true;
    return Object.keys(out).length ? out : null;
  }
  if (type === "postgres" || type === "mysql" || type === "oracle" || type === "mssql") {
    const query = String(input.query ?? "").trim();
    if (query) {
      // Query monitor dijalankan berulang kali selamanya; yang mengubah data
      // tidak pada tempatnya di sini dan gampang tidak disengaja.
      if (!/^\s*(select|show|explain)\b/i.test(query)) {
        errors.push("Query monitor harus diawali SELECT, SHOW, atau EXPLAIN");
      } else {
        out.query = query.slice(0, 500);
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

// Ambang latency (ms). Di atas ini monitor dianggap degraded — masih hidup,
// tapi lebih lambat dari yang dijanjikan. Kosong berarti tidak dinilai.
function cleanLatencyThreshold(body, errors) {
  if (body.latency_threshold_ms === undefined) return undefined;
  if (body.latency_threshold_ms === null || body.latency_threshold_ms === "") return null;
  const n = Number(body.latency_threshold_ms);
  if (!Number.isFinite(n)) { errors.push("Ambang latency harus berupa angka"); return null; }
  if (n <= 0) { errors.push("Ambang latency harus lebih dari 0 ms"); return null; }
  // Batas atas mengikuti timeout terpanjang yang bisa disetel (300 detik):
  // ambang di atas timeout tidak akan pernah tercapai.
  if (n > 300_000) { errors.push("Ambang latency maksimal 300000 ms"); return null; }
  return Math.round(n);
}

// push_token adalah kredensial: hanya admin yang boleh melihatnya, dan selalu
// dikirim bersama URL siap pakai supaya gampang disalin.
function shape(monitor, user) {
  if (!monitor) return monitor;
  const isAdmin = user?.role === "admin";
  // auth_secret sudah dibuang decorateMonitors; di sini hanya username Basic Auth
  // yang dibuka kembali agar form bisa menampilkannya. Password/token tidak pernah keluar.
  const { push_token, auth_secret, conn_secret, auth_username, ...rest } = monitor;
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
    slo_target: cleanSloTarget(body, errors),
    auth_type: AUTH_TYPES.includes(body.auth_type) ? body.auth_type : "none",
  };

  // undefined = field tidak dikirim, biarkan nilai lama (penting untuk PUT parsial)
  const latency = cleanLatencyThreshold(body, errors);
  if (latency !== undefined) m.latency_threshold_ms = latency;

  const renotify = cleanRenotifyMinutes(body.renotify_minutes);
  if (renotify !== undefined) {
    if (renotify && renotify.error) errors.push(renotify.error);
    else m.renotify_minutes = renotify;
  } else if (!existing) {
    // Hanya saat monitor dibuat; pada edit, field yang tidak dikirim dibiarkan
    m.renotify_minutes = config.renotifyDefaultMinutes;
  }

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

  // Monitor database menyimpan connection string terenkripsi dan opsinya sendiri
  if (DATABASE_TYPES.includes(m.type)) {
    const conn = resolveConnSecret(body, existing, m.type, errors);
    if (conn !== undefined) m.conn_secret = conn;
    m.check_config = cleanCheckConfig(body, m.type, errors);
  } else if (m.type === "grpc" || m.type === "kafka") {
    // Keduanya memakai alamat biasa; yang khusus hanya opsinya
    m.conn_secret = null;
    m.check_config = cleanCheckConfig(body, m.type, errors);
  } else {
    // Ganti tipe ke non-database: kredensial lamanya tidak ditinggalkan di DB
    m.conn_secret = null;
    m.check_config = null;
  }

  // Webhook aksi berlaku untuk semua tipe monitor, termasuk push dan ping
  Object.assign(m, cleanActionWebhook(body, errors));

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
  } else if (DATABASE_TYPES.includes(m.type)) {
    // Targetnya ada di dalam connection string, bukan di field hostname
  } else if (m.type === "kafka") {
    // Targetnya daftar broker di check_config, bukan satu hostname
  } else if (!m.hostname) {
    errors.push("Hostname wajib diisi");
  }
  if ((m.type === "tcp" || m.type === "grpc") && !(m.port > 0 && m.port < 65536)) errors.push("Port tidak valid");

  return { m, errors };
}

// Monitor induk divalidasi terpisah karena perlu membaca DB: induk harus ada,
// bukan dirinya sendiri, tidak membentuk lingkaran, dan rantainya tidak terlalu dalam.
// undefined = field tidak dikirim (biarkan apa adanya), null = lepas dari induk.
async function resolveParent(body, selfId, errors) {
  if (body.parent_id === undefined) return undefined;
  if (body.parent_id === null || body.parent_id === "") return null;

  const parentId = Number(body.parent_id);
  if (!Number.isFinite(parentId)) { errors.push("Monitor induk tidak valid"); return undefined; }
  if (selfId && parentId === selfId) { errors.push("Monitor tidak bisa menjadi induk dirinya sendiri"); return undefined; }

  const parent = await prisma.monitor.findUnique({ where: { id: parentId }, select: { id: true, name: true } });
  if (!parent) { errors.push("Monitor induk tidak ditemukan"); return undefined; }
  if (selfId && (await wouldCycle(selfId, parentId))) {
    errors.push(`"${parent.name}" sudah bergantung pada monitor ini — hubungan induk akan membentuk lingkaran`);
    return undefined;
  }
  if ((await chainDepth(parentId)) + 1 >= MAX_DEPTH) {
    errors.push(`Rantai dependency maksimal ${MAX_DEPTH} tingkat`);
    return undefined;
  }
  return parentId;
}

// Escalation policy monitor. Tidak dikirim = jangan disentuh; dikirim kosong =
// kembali memakai policy default.
async function resolveEscalationPolicy(body, errors) {
  if (body.escalation_policy_id === undefined) return undefined;
  if (body.escalation_policy_id === null || body.escalation_policy_id === "") return null;
  const id = Number(body.escalation_policy_id);
  if (!Number.isFinite(id)) { errors.push("Escalation policy tidak valid"); return undefined; }
  if (!(await prisma.escalationPolicy.findUnique({ where: { id } }))) {
    errors.push("Escalation policy tidak ditemukan");
    return undefined;
  }
  return id;
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
  const parentId = await resolveParent(req.body, null, errors);
  const policyId = await resolveEscalationPolicy(req.body, errors);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  // Monitor push langsung diberi token; tipe lain tidak memerlukannya
  const created = await prisma.monitor.create({
    data: {
      ...m,
      parent_id: parentId ?? null,
      escalation_policy_id: policyId ?? null,
      push_token: m.type === "push" ? newPushToken() : null,
    },
  });
  invalidateDependencyCache();
  await syncRelations(created.id, req.body);
  scheduleNow(created.id);
  recordAudit(req, {
    action: "monitor.create", entity: "monitor", entityId: created.id, entityName: created.name,
    summary: `Monitor ${created.type} "${created.name}" dibuat`,
    changes: snapshotFields(created),
  });
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
  const parentId = await resolveParent(req.body, id, errors);
  const policyId = await resolveEscalationPolicy(req.body, errors);
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });
  // Berganti tipe ke/dari push: token dibuat saat dibutuhkan, dibuang saat tidak
  const data = { ...m };
  if (parentId !== undefined) data.parent_id = parentId;
  if (policyId !== undefined) data.escalation_policy_id = policyId;
  if (m.type === "push" && !existing.push_token) data.push_token = newPushToken();
  if (m.type !== "push" && existing.push_token) data.push_token = null;
  const updated = await prisma.monitor.update({ where: { id }, data });
  invalidateDependencyCache();
  await syncRelations(id, req.body);
  m.active ? scheduleNow(id) : unschedule(id);
  recordAudit(req, {
    action: "monitor.update", entity: "monitor", entityId: id, entityName: updated.name,
    summary: `Monitor "${updated.name}" diubah`,
    changes: diffFields(existing, data),
  });
  res.json(shape(await findMonitor(id), req.user));
});

monitorsRouter.post("/:id/pause", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const m = await prisma.monitor.update({ where: { id }, data: { active: false } });
  invalidateDependencyCache();
  unschedule(id);

  // Monitor yang dijeda tidak lagi dicek, jadi incident yang masih terbuka tidak
  // akan pernah ditutup oleh heartbeat "up". Kalau dibiarkan, incident itu
  // dianggap berjalan sampai sekarang dan terus menggerus error budget di
  // laporan SLA. Dijeda karena itu diperlakukan sebagai akhir incident:
  // downtime yang dihitung berhenti di sini, bukan di waktu monitor dijalankan
  // lagi. Rantai eskalasinya ikut berhenti — tidak ada gunanya memanggil orang
  // untuk monitor yang sengaja dimatikan.
  const open = await prisma.incident.findFirst({ where: { monitor_id: id, resolved_at: null }, orderBy: { id: "desc" } });
  if (open) {
    await prisma.incident.update({ where: { id: open.id }, data: { resolved_at: new Date() } });
    await stopEscalation(open.id, "paused").catch((e) => console.error("[escalation]", e));
  }

  recordAudit(req, {
    action: "monitor.pause", entity: "monitor", entityId: id, entityName: m.name,
    summary: open ? `Monitor "${m.name}" dijeda — incident #${open.id} ikut ditutup` : `Monitor "${m.name}" dijeda`,
  });
  res.json(shape(await findMonitor(id), req.user));
});
monitorsRouter.post("/:id/resume", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const m = await prisma.monitor.update({ where: { id }, data: { active: true } });
  invalidateDependencyCache();
  scheduleNow(id);
  recordAudit(req, { action: "monitor.resume", entity: "monitor", entityId: id, entityName: m.name, summary: `Monitor "${m.name}" dijalankan lagi` });
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
  recordAudit(req, {
    action: "monitor.reset_push_token", entity: "monitor", entityId: id, entityName: monitor.name,
    summary: `Token push "${monitor.name}" dibuat ulang — URL lama tidak berlaku lagi`,
  });
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
  const existing = await prisma.monitor.findUnique({ where: { id } });
  // Monitor yang jadi induk: anaknya tidak ikut terhapus, hanya lepas (SET NULL)
  const orphaned = await prisma.monitor.count({ where: { parent_id: id } });
  await prisma.monitor.delete({ where: { id } }).catch(() => {});
  invalidateDependencyCache();
  unschedule(id);
  if (existing) {
    recordAudit(req, {
      action: "monitor.delete", entity: "monitor", entityId: id, entityName: existing.name,
      summary: `Monitor "${existing.name}" dihapus` + (orphaned ? ` — ${orphaned} monitor anak jadi mandiri` : ""),
      changes: snapshotFields(existing),
    });
  }
  res.json({ ok: true });
});

// Heartbeat history untuk grafik: ?hours=24
// ?hours=24 &location=<nama|all>. Tanpa parameter lokasi, dipakai lokasi primary
// supaya grafik tetap sama seperti sebelum multi-location ada.
// Ringkasan harian untuk grafik jangka panjang. Sumbernya tabel rollup, bukan
// heartbeat, sehingga rentangnya tidak terbatas pada retensi heartbeat.
monitorsRouter.get("/:id/daily", async (req, res) => {
  const days = Math.min(730, Math.max(1, Number(req.query.days) || 90));
  res.json(await dailySeries(req.params.id, { days }));
});

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
      maintenance: true, degraded: true, location: true, assertion_ok: true, assertion_message: true, created_at: true,
    },
  });
  res.json(rows);
});

monitorsRouter.get("/:id/incidents", async (req, res) => {
  const rows = await prisma.incident.findMany({ where: { monitor_id: Number(req.params.id) }, orderBy: { started_at: "desc" }, take: 100 });
  // Nama induk yang menahan alert ikut dikirim supaya UI tidak perlu query lagi
  const ids = [...new Set(rows.map((r) => r.suppressed_by_id).filter(Boolean))];
  const names = new Map(
    (ids.length ? await prisma.monitor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []).map((m) => [m.id, m.name])
  );
  res.json(rows.map((r) => ({ ...r, suppressed_by: r.suppressed_by_id ? { id: r.suppressed_by_id, name: names.get(r.suppressed_by_id) || null } : null })));
});

// Monitor yang bergantung pada monitor ini (anak langsung), lengkap dengan statusnya
monitorsRouter.get("/:id/children", async (req, res) => {
  const rows = await prisma.monitor.findMany({
    where: { parent_id: Number(req.params.id) },
    include: monitorInclude,
    orderBy: { name: "asc" },
  });
  const decorated = await decorateMonitors(rows, { beats: 1, locations: false });
  res.json(decorated.map((m) => shape(m, req.user)));
});

// Event penting (perubahan status) untuk list "Important events".
// Seperti grafik, defaultnya lokasi primary supaya daftarnya satu alur cerita;
// ?location=all menampilkan perubahan dari semua lokasi.
monitorsRouter.get("/:id/events", async (req, res) => {
  const requested = req.query.location ? String(req.query.location) : null;
  const where = { monitor_id: Number(req.params.id), important: true };
  if (requested !== "all") Object.assign(where, locationFilter(requested || config.primaryLocation));
  res.json(await prisma.heartbeat.findMany({ where, orderBy: { created_at: "desc" }, take: 50 }));
});

// Timeline event non-heartbeat: laporan otomasi dari webhook inbound
monitorsRouter.get("/:id/events-log", async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json(
    await prisma.monitorEvent.findMany({
      where: { monitor_id: Number(req.params.id) },
      orderBy: { created_at: "desc" },
      take,
    })
  );
});

// Riwayat pemanggilan webhook aksi, termasuk percobaan yang gagal.
// Admin-only: URL dan header webhook bisa mengandung token.
monitorsRouter.get("/:id/webhook-logs", requireAdmin, async (req, res) => {
  const take = Math.min(200, Math.max(1, Number(req.query.limit) || 30));
  res.json(
    await prisma.webhookLog.findMany({
      where: { monitor_id: Number(req.params.id) },
      orderBy: { created_at: "desc" },
      take,
    })
  );
});

// Uji webhook aksi tanpa menunggu monitor benar-benar down
monitorsRouter.post("/:id/test-action-webhook", requireAdmin, async (req, res) => {
  const monitor = await prisma.monitor.findUnique({ where: { id: Number(req.params.id) } });
  if (!monitor) return res.status(404).json({ error: "Monitor tidak ditemukan" });
  if (!monitor.action_webhook_url) return res.status(400).json({ error: "Monitor ini belum punya URL webhook aksi" });
  // Paksa kirim walau saklar on_down/on_recover dimatikan
  const result = await triggerActionWebhook({ ...monitor, action_on_down: true }, "down", {});
  if (!result?.ok) return res.status(400).json({ error: result?.error || "Pemanggilan webhook gagal", ...result });
  res.json({ ok: true, ...result });
});

// Maintenance window milik monitor ini
monitorsRouter.get("/:id/maintenance", async (req, res) => {
  const { decorateWindow } = await import("../lib/maintenance.js");
  const rows = await prisma.maintenanceWindow.findMany({ where: { monitor_id: Number(req.params.id) }, orderBy: [{ active: "desc" }, { start_at: "desc" }] });
  res.json(rows.map(decorateWindow));
});
