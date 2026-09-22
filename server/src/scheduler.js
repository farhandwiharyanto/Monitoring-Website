import cron from "node-cron";
import { prisma, pruneOldHeartbeats } from "./db.js";
import { runCheck } from "./checks/index.js";
import { notifyMonitorEvent } from "./notifications/index.js";
import { STATUS } from "./lib/status.js";
import { findMonitor } from "./lib/stats.js";
import { isInMaintenance } from "./lib/maintenance.js";

// State in-memory per monitor: kapan check berikutnya, retry count, sedang jalan atau tidak
const state = new Map(); // id -> { nextRun, retries, running }
let io = null;
let cache = { monitors: [], at: 0, dirty: true };

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
  state.set(monitorId, { nextRun: 0, retries: 0, running: false });
  cache.dirty = true;
}
export function unschedule(monitorId) {
  state.delete(monitorId);
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
      s = { nextRun: 0, retries: 0, running: false };
      state.set(m.id, s);
    }
    if (s.running || now < s.nextRun) continue;
    s.running = true;
    execute(m, s)
      .catch((e) => console.error(`[scheduler] monitor #${m.id}:`, e))
      .finally(() => (s.running = false));
  }
}

async function execute(monitor, s) {
  const [result, maint] = await Promise.all([runCheck(monitor), isInMaintenance(monitor.id)]);
  const inMaint = !!maint;
  const prev = await prisma.heartbeat.findFirst({
    where: { monitor_id: monitor.id, status: { in: [0, 1] } },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
  });
  const prevStatus = prev ? prev.status : null;

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

  const important = status !== STATUS.PENDING && prevStatus !== status;
  const beat = await prisma.heartbeat.create({
    data: { monitor_id: monitor.id, status, message: result.message, response_time: result.ms, important, maintenance: inMaint },
  });

  // Interval: saat retry pakai 1/3 interval (min 5s) supaya cepat memastikan
  const interval = status === STATUS.PENDING ? Math.max(5, Math.floor(monitor.interval_seconds / 3)) : monitor.interval_seconds;
  s.nextRun = Date.now() + interval * 1000;

  // Incident selalu dicatat; alert hanya dikirim di luar maintenance window.
  if (status === STATUS.DOWN) {
    let incident = await prisma.incident.findFirst({ where: { monitor_id: monitor.id, resolved_at: null }, orderBy: { id: "desc" } });
    if (!incident || prevStatus !== STATUS.DOWN) {
      incident = await prisma.incident.create({
        data: { monitor_id: monitor.id, cause: (inMaint ? "[maintenance] " : "") + result.message, maintenance: inMaint },
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

  if (io) {
    const decorated = await findMonitor(monitor.id);
    io.to("admin").emit("heartbeat", { monitorId: monitor.id, heartbeat: beat, monitor: decorated });
    if (important) io.to("admin").emit("monitor:status", { monitorId: monitor.id, status });
    io.emit("public:heartbeat", {
      monitorId: monitor.id, status: decorated.status, maintenance: inMaint,
      response_time: beat.response_time, created_at: beat.created_at,
    });
  }
}
