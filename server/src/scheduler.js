import cron from "node-cron";
import { prisma, pruneOldHeartbeats, pruneOldAuditLogs } from "./db.js";
import { config, isPrimaryLocation } from "./config.js";
import { runCheck } from "./checks/index.js";
import { fetchCertInfo, tlsTarget } from "./checks/cert.js";
import { notifyMonitorEvent, notifyCertExpiry } from "./notifications/index.js";
import { triggerActionWebhook } from "./lib/actionWebhook.js";
import { STATUS } from "./lib/status.js";
import { findMonitor } from "./lib/stats.js";
import { isInMaintenance } from "./lib/maintenance.js";
import { blockingAncestor } from "./lib/dependency.js";

// State in-memory per monitor: kapan check berikutnya, retry count, sedang jalan atau tidak
const state = new Map(); // id -> { nextRun, retries, running, nextCertCheck }
let io = null;
let cache = { monitors: [], at: 0, dirty: true };

// Handshake TLS mahal, jadi sertifikat tidak diperiksa tiap interval check
const certCheckIntervalMs = () => Math.max(1, config.certCheckIntervalHours) * 3600_000;

export function initScheduler(socketIo) {
  io = socketIo;
  // node-cron: tick setiap detik, jalankan monitor yang sudah jatuh tempo
  cron.schedule("* * * * * *", () => tick().catch((e) => console.error("[scheduler]", e)));
  // Bersihkan heartbeat & audit log lama setiap hari jam 03:00
  cron.schedule("0 3 * * *", () => {
    pruneOldHeartbeats().catch(console.error);
    pruneOldAuditLogs().catch(console.error);
  });
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

  await applyResult(monitor, { status, message: result.message, ms: result.ms, assertion: result.assertion }, { inMaint: !!maint });

  // Interval: saat retry pakai 1/3 interval (min 5s) supaya cepat memastikan
  const interval = status === STATUS.PENDING ? Math.max(5, Math.floor(monitor.interval_seconds / 3)) : monitor.interval_seconds;
  s.nextRun = Date.now() + interval * 1000;

  // Sertifikat TLS dicek terpisah & jarang — handshake tidak perlu tiap interval
  // Hanya lokasi primary yang menyimpan & memperingatkan sertifikat, supaya
  // beberapa lokasi tidak mengirim alert yang sama.
  if (status === STATUS.UP && monitor.check_cert && isPrimaryLocation() && Date.now() >= (s.nextCertCheck || 0)) {
    s.nextCertCheck = Date.now() + certCheckIntervalMs();
    inspectCertificate(monitor).catch((e) => console.error(`[cert] monitor #${monitor.id}:`, e.message));
  }
}

// Catat heartbeat + kelola incident + kirim alert + siarkan ke socket.
// Dipakai scheduler maupun endpoint push, sehingga perilakunya persis sama.
export async function applyResult(monitor, { status, message, ms, assertion }, opts = {}) {
  const location = config.locationName;
  const primary = isPrimaryLocation();
  const inMaint = opts.inMaint !== undefined ? opts.inMaint : !!(await isInMaintenance(monitor.id));

  // Transisi status dihitung per lokasi: tiap agen punya riwayatnya sendiri.
  // Baris lama (location null) dianggap milik lokasi primary.
  const prev = await prisma.heartbeat.findFirst({
    where: { monitor_id: monitor.id, status: { in: [STATUS.DOWN, STATUS.UP] }, ...locationFilter(location) },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
  });
  const prevStatus = prev ? prev.status : null;
  const important = status !== STATUS.PENDING && prevStatus !== status;

  const beat = await prisma.heartbeat.create({
    data: {
      monitor_id: monitor.id, status, message, response_time: ms ?? null,
      important, maintenance: inMaint, location,
      assertion_ok: assertion ? assertion.ok : null,
      assertion_message: assertion ? assertion.message : null,
    },
  });

  // Lokasi sekunder hanya merekam heartbeat untuk perbandingan. Incident dan
  // alert tetap dipegang lokasi primary agar tidak ada alert ganda.
  if (!primary) return beat;

  // Induk yang sedang down menahan alert monitor ini: satu gangguan di lapisan
  // bawah (router, gateway, database) tidak perlu memicu alert dari semua
  // layanan di atasnya. Check tetap jalan dan incident tetap dicatat — hanya
  // notifikasi & webhook aksinya yang diam.
  const blocker = monitor.parent_id ? await blockingAncestor(monitor.id) : null;

  // Incident selalu dicatat; alert hanya dikirim di luar maintenance window.
  if (status === STATUS.DOWN) {
    let incident = await prisma.incident.findFirst({ where: { monitor_id: monitor.id, resolved_at: null }, orderBy: { id: "desc" } });
    if (!incident || prevStatus !== STATUS.DOWN) {
      incident = await prisma.incident.create({
        data: {
          monitor_id: monitor.id, cause: (inMaint ? "[maintenance] " : "") + message, maintenance: inMaint,
          suppressed: !!blocker, suppressed_by_id: blocker?.id ?? null,
        },
      });
    } else if (!!blocker !== incident.suppressed) {
      // Keadaan induk berubah di tengah incident — penandanya ikut diperbarui
      incident = await prisma.incident.update({
        where: { id: incident.id },
        data: { suppressed: !!blocker, suppressed_by_id: blocker?.id ?? null },
      });
    }
    // Kirim alert "down" sekali: saat pertama down, saat maintenance berakhir
    // tapi masih down, atau saat induk sudah pulih sementara monitor ini tetap
    // down — berarti masalahnya memang miliknya sendiri.
    if (!inMaint && !blocker && !incident.notified) {
      await prisma.incident.update({ where: { id: incident.id }, data: { notified: true } });
      notifyMonitorEvent(monitor, "down", beat, incident);
      // Webhook aksi memicu otomasi di sistem lain (restart, buka ticket).
      // Sengaja tidak di-await: retry-nya tidak boleh menahan scheduler.
      triggerActionWebhook(monitor, "down", { incident, heartbeat: beat }).catch(() => {});
    }
  } else if (status === STATUS.UP && prevStatus === STATUS.DOWN) {
    const incident = await prisma.incident.findFirst({ where: { monitor_id: monitor.id, resolved_at: null }, orderBy: { id: "desc" } });
    if (incident) await prisma.incident.update({ where: { id: incident.id }, data: { resolved_at: new Date() } });
    // Alert "recover" hanya jika alert "down"-nya pernah terkirim. Incident yang
    // alert-nya ditahan dependency karenanya juga tidak mengabari saat pulih.
    if (!inMaint && incident?.notified) {
      notifyMonitorEvent(monitor, "up", beat, incident);
      triggerActionWebhook(monitor, "recover", { incident, heartbeat: beat }).catch(() => {});
    }
  }

  await broadcast(monitor.id, beat, { important, status, inMaint });
  return beat;
}

// Baris heartbeat lama ditulis sebelum multi-location ada (location null),
// jadi lokasi primary ikut memilikinya.
export function locationFilter(location) {
  return location === config.primaryLocation
    ? { OR: [{ location: null }, { location }] }
    : { location };
}

// Event non-heartbeat (laporan otomasi, catatan manual) disiarkan ke dashboard
// supaya timeline monitor ikut hidup tanpa perlu refresh.
export function emitMonitorEvent(monitorId, event) {
  if (!io) return;
  io.to("admin").emit("monitor:event", { monitorId, event });
}

async function broadcast(monitorId, beat, { important, status, inMaint }) {
  if (!io) return;
  const full = await findMonitor(monitorId);
  if (!full) return;
  // push_token tidak pernah disiarkan lewat socket — room ini juga berisi viewer
  const { push_token, ...decorated } = full;
  io.to("admin").emit("heartbeat", { monitorId, heartbeat: beat, monitor: decorated, location: beat.location });
  if (important) io.to("admin").emit("monitor:status", { monitorId, status });
  io.emit("public:heartbeat", {
    monitorId, status: decorated.status, maintenance: inMaint,
    response_time: beat.response_time, created_at: beat.created_at,
  });
}

// Ambang terkecil yang sudah terlewati, mis. sisa 10 hari dengan ambang
// [30,14,7,3] menghasilkan 14. null berarti belum melewati ambang mana pun.
export function crossedThreshold(daysRemaining, thresholds = config.certAlertThresholds) {
  const crossed = thresholds.filter((t) => daysRemaining <= t);
  return crossed.length ? Math.min(...crossed) : null;
}

// Kolom sertifikat hasil satu pemeriksaan
const certColumns = (info) => ({
  cert_expires_at: info.valid_to,
  cert_issuer: info.issuer,
  cert_subject: info.subject,
  cert_chain_valid: info.authorized,
  cert_chain_error: info.authorization_error || null,
  cert_checked_at: new Date(),
});

// Simpan data sertifikat dan kirim peringatan sekali per ambang yang dilewati.
// Saat sertifikat diperbarui (sisa hari kembali di atas ambang terbesar),
// penandanya direset sehingga siklus peringatan berikutnya berjalan lagi.
async function inspectCertificate(monitor) {
  const target = tlsTarget(monitor);
  if (!target) return;
  const info = await fetchCertInfo({ ...target, timeoutSeconds: Math.min(monitor.timeout_seconds || 10, 15) });
  if (!info.ok) return;

  const data = certColumns(info);
  const threshold = crossedThreshold(info.days_remaining);
  const notified = monitor.cert_notified_threshold;

  if (threshold === null) {
    // Sertifikat masih panjang umurnya — siap memperingatkan lagi nanti
    if (notified !== null && notified !== undefined) data.cert_notified_threshold = null;
  } else if (notified === null || notified === undefined || threshold < notified) {
    // Ambang baru yang lebih mendesak: kirim sekali, lalu catat
    data.cert_notified_threshold = threshold;
    notifyCertExpiry(monitor, { ...info, threshold });
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
    await prisma.monitor.update({ where: { id: monitor.id }, data: certColumns(info) });
    invalidateCache();
  }
  return info;
}
