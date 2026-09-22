import cron from "node-cron";
import { prisma, pruneOldHeartbeats } from "./db.js";
import { config } from "./config.js";
import { runCheck } from "./checks/index.js";
import { fetchCertInfo, tlsTarget } from "./checks/cert.js";
import { notifyMonitorEvent, notifyCertExpiry } from "./notifications/index.js";
import { STATUS } from "./lib/status.js";
import { findMonitor } from "./lib/stats.js";
import { isInMaintenance } from "./lib/maintenance.js";

// State in-memory per monitor: kapan check berikutnya, retry count, sedang jalan atau tidak
const state = new Map(); // id -> { nextRun, retries, running, nextCertCheck }
let io = null;
let cache = { monitors: [], at: 0, dirty: true };

const CERT_CHECK_INTERVAL_MS = 6 * 3600_000; // sertifikat cukup dicek tiap 6 jam

export function initScheduler(socketIo) {
  io = socketIo;
  // node-cron: tick setiap detik, jalankan monitor yang sudah jatuh tempo
  cron.schedule("* * * * * *", () => tick().catch((e) => console.error("[scheduler]", e)));
  // Bersihkan heartbeat lama setiap hari jam 03:00
  cron.schedule("0 3 * * *", () => pruneOldHeartbeats().catch(console.error));
  console.log("[scheduler] berjalan");
}

// Dipanggil setelah monitor dibuat/diubah agar langsung dicek
export function scheduleNow(monitorId) {
  state.set(monitorId, { nextRun: 0, retries: 0, running: false, nextCertCheck: 0 });
  cache.dirty = true;
}
export function unschedule(monitorId) {
  state.delete(monitorId);
  cache.dirty = true;
}
export function invalidateCache() {
  cache.dirty = true;
}

async function activeMonitors() {
  if (cache.dirty || Date.now() - cache.at > 10_000) {
    cache = { monitors: await prisma.monitor.findMany({ where: { active: true } }), at: Date.now(), dirty: false };
  }
  return cache.monitors;
}

async function tick() {
  const now = Date.now();
  const monitors = await activeMonitors();
  const activeIds = new Set(monitors.map((m) => m.id));
  for (const id of state.keys()) if (!activeIds.has(id)) state.delete(id);

  for (const m of monitors) {
    let s = state.get(m.id);
    if (!s) {
      s = { nextRun: 0, retries: 0, running: false, nextCertCheck: 0 };
      state.set(m.id, s);
    }
    if (s.running || now < s.nextRun) continue;
    s.running = true;
    const job = m.type === "push" ? checkPushFreshness(m, s) : execute(m, s);
    job.catch((e) => console.error(`[scheduler] monitor #${m.id}:`, e)).finally(() => (s.running = false));
  }
}

// Monitor pasif: target yang mengirim heartbeat sendiri ke /api/push/<token>.
// Scheduler hanya memeriksa apakah heartbeat terakhir sudah kedaluwarsa.
async function checkPushFreshness(monitor, s) {
  const last = await prisma.heartbeat.findFirst({
    where: { monitor_id: monitor.id },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
  });
  const since = last ? new Date(last.created_at).getTime() : new Date(monitor.created_at).getTime();
  const deadline = since + (monitor.interval_seconds + monitor.push_grace_seconds) * 1000;
  s.nextRun = Date.now() + 5000; // cukup dicek tiap 5 detik

  if (Date.now() <= deadline) return;          // masih dalam tenggat, tidak ada yang dicatat
  if (last && last.status === STATUS.DOWN) return; // sudah tercatat down, jangan menumpuk

  const late = Math.round((Date.now() - since) / 1000);
  await applyResult(monitor, {
    status: STATUS.DOWN,
    message: `Tidak ada push heartbeat selama ${late}s (batas ${monitor.interval_seconds + monitor.push_grace_seconds}s)`,
    ms: null,
  });
}

async function execute(monitor, s) {
  const [result, maint] = await Promise.all([runCheck(monitor), isInMaintenance(monitor.id)]);

  let status;
  if (result.ok) {
    status = STATUS.UP;
    s.retries = 0;
  } else if (s.retries < monitor.max_retries) {
    // Belum melewati retries: catat sebagai pending, cek lagi dalam interval lebih pendek
    s.retries += 1;
    status = STATUS.PENDING;
    result.message = `Retry ${s.retries}/${monitor.max_retries}: ${result.message}`;
  } else {
    status = STATUS.DOWN;
  }

  await applyResult(monitor, { status, message: result.message, ms: result.ms }, { inMaint: !!maint });

  // Interval: saat retry pakai 1/3 interval (min 5s) supaya cepat memastikan
  const interval = status === STATUS.PENDING ? Math.max(5, Math.floor(monitor.interval_seconds / 3)) : monitor.interval_seconds;
  s.nextRun = Date.now() + interval * 1000;

  // Sertifikat TLS dicek terpisah & jarang — handshake tidak perlu tiap interval
  if (status === STATUS.UP && monitor.check_cert && Date.now() >= (s.nextCertCheck || 0)) {
    s.nextCertCheck = Date.now() + CERT_CHECK_INTERVAL_MS;
    inspectCertificate(monitor).catch((e) => console.error(`[cert] monitor #${monitor.id}:`, e.message));
  }
}

// Catat heartbeat + kelola incident + kirim alert + siarkan ke socket.
// Dipakai scheduler maupun endpoint push, sehingga perilakunya persis sama.
export async function applyResult(monitor, { status, message, ms }, opts = {}) {
  const inMaint = opts.inMaint !== undefined ? opts.inMaint : !!(await isInMaintenance(monitor.id));
  const prev = await prisma.heartbeat.findFirst({
    where: { monitor_id: monitor.id, status: { in: [STATUS.DOWN, STATUS.UP] } },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
  });
  const prevStatus = prev ? prev.status : null;
  const important = status !== STATUS.PENDING && prevStatus !== status;

  const beat = await prisma.heartbeat.create({
    data: { monitor_id: monitor.id, status, message, response_time: ms ?? null, important, maintenance: inMaint },
  });

  // Incident selalu dicatat; alert hanya dikirim di luar maintenance window.
  if (status === STATUS.DOWN) {
    let incident = await prisma.incident.findFirst({ where: { monitor_id: monitor.id, resolved_at: null }, orderBy: { id: "desc" } });
    if (!incident || prevStatus !== STATUS.DOWN) {
      incident = await prisma.incident.create({
        data: { monitor_id: monitor.id, cause: (inMaint ? "[maintenance] " : "") + message, maintenance: inMaint },
      });
    }
    // Kirim alert "down" sekali: saat pertama down, atau saat maintenance berakhir tapi masih down
    if (!inMaint && !incident.notified) {
      await prisma.incident.update({ where: { id: incident.id }, data: { notified: true } });
      notifyMonitorEvent(monitor, "down", beat, incident);
    }
  } else if (status === STATUS.UP && prevStatus === STATUS.DOWN) {
    const incident = await prisma.incident.findFirst({ where: { monitor_id: monitor.id, resolved_at: null }, orderBy: { id: "desc" } });
    if (incident) await prisma.incident.update({ where: { id: incident.id }, data: { resolved_at: new Date() } });
    // Alert "recover" hanya jika alert "down"-nya pernah terkirim
    if (!inMaint && incident?.notified) notifyMonitorEvent(monitor, "up", beat, incident);
  }

  await broadcast(monitor.id, beat, { important, status, inMaint });
  return beat;
}

async function broadcast(monitorId, beat, { important, status, inMaint }) {
  if (!io) return;
  const full = await findMonitor(monitorId);
  if (!full) return;
  // push_token tidak pernah disiarkan lewat socket — room ini juga berisi viewer
  const { push_token, ...decorated } = full;
  io.to("admin").emit("heartbeat", { monitorId, heartbeat: beat, monitor: decorated });
  if (important) io.to("admin").emit("monitor:status", { monitorId, status });
  io.emit("public:heartbeat", {
    monitorId, status: decorated.status, maintenance: inMaint,
    response_time: beat.response_time, created_at: beat.created_at,
  });
}

// Simpan tanggal kedaluwarsa sertifikat & kirim peringatan bila sudah dekat.
// Peringatan diulang maksimal sekali per hari selama masih dalam ambang batas.
async function inspectCertificate(monitor) {
  const target = tlsTarget(monitor);
  if (!target) return;
  const info = await fetchCertInfo({ ...target, timeoutSeconds: Math.min(monitor.timeout_seconds || 10, 15) });
  if (!info.ok) return;

  const data = { cert_expires_at: info.valid_to, cert_issuer: info.issuer };
  const warn = info.days_remaining <= config.certExpiryWarnDays;
  const lastNotified = monitor.cert_notified_at ? new Date(monitor.cert_notified_at).getTime() : 0;

  if (warn && Date.now() - lastNotified > 86400_000) {
    data.cert_notified_at = new Date();
    notifyCertExpiry(monitor, info);
  } else if (!warn && monitor.cert_notified_at) {
    data.cert_notified_at = null; // sertifikat sudah diperbarui — siap memperingatkan lagi nanti
  }

  await prisma.monitor.update({ where: { id: monitor.id }, data });
  invalidateCache();
}

// Dipakai tombol "Cek sertifikat sekarang" di UI
export async function checkCertificateNow(monitor) {
  const target = tlsTarget(monitor);
  if (!target) return { ok: false, error: "Monitor ini bukan HTTPS" };
  const info = await fetchCertInfo({ ...target, timeoutSeconds: 15 });
  if (info.ok) {
    await prisma.monitor.update({
      where: { id: monitor.id },
      data: { cert_expires_at: info.valid_to, cert_issuer: info.issuer },
    });
    invalidateCache();
  }
  return info;
}
