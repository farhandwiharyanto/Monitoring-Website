import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";

// Uptime untuk laporan SLA dihitung BERBASIS WAKTU dari durasi incident, bukan
// dari rasio jumlah heartbeat seperti angka di dashboard. Dua-duanya benar untuk
// keperluannya masing-masing: rasio heartbeat murah dan cukup untuk pemantauan
// sehari-hari, sedangkan SLA perlu "berapa detik layanan ini benar-benar mati".
// Keduanya bisa berbeda tipis, dan itu memang disengaja — lihat docs/laporan.md.

const SECONDS_PER_DAY = 86400;

// Awal & akhir bulan kalender (waktu server) untuk sebuah tanggal
export function monthRange(date = new Date()) {
  const d = new Date(date);
  const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
  return { from, to };
}

// "2026-09" → rentang bulan itu. Format lain dikembalikan null.
export function parseMonth(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { from: new Date(year, month - 1, 1), to: new Date(year, month, 1) };
}

export const monthKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

// Downtime, jumlah incident, dan MTTR per monitor dalam satu rentang.
// Catatan: kolom waktu Prisma bertipe timestamp tanpa zona dan isinya UTC,
// sedangkan NOW() bertipe timestamptz. Keduanya disamakan dengan
// `AT TIME ZONE 'UTC'` supaya incident yang masih berjalan tetap terhitung
// benar walau timezone server database bukan UTC.
// Incident yang melewati batas rentang dipotong supaya tidak dihitung berlebih,
// dan incident yang masih berjalan dipotong di "sekarang".
async function downtimeMap(from, to, { excludeMaintenance }) {
  const rows = await prisma.$queryRaw`
    SELECT monitor_id,
           SUM(EXTRACT(EPOCH FROM (
             LEAST(COALESCE(resolved_at, (NOW() AT TIME ZONE 'UTC')), ${to}::timestamp) -
             GREATEST(started_at, ${from}::timestamp)
           )))::float AS down_seconds,
           COUNT(*)::int AS incidents,
           COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS ongoing,
           AVG(EXTRACT(EPOCH FROM (resolved_at - started_at)))
             FILTER (WHERE resolved_at IS NOT NULL)::float AS mttr_seconds,
           MAX(EXTRACT(EPOCH FROM (COALESCE(resolved_at, (NOW() AT TIME ZONE 'UTC')) - started_at)))::float AS longest_seconds
    FROM incidents
    WHERE started_at < ${to}::timestamp
      AND (resolved_at IS NULL OR resolved_at > ${from}::timestamp)
      ${excludeMaintenance ? Prisma.sql`AND maintenance = false` : Prisma.empty}
    GROUP BY monitor_id`;

  const map = new Map();
  for (const r of rows) {
    map.set(r.monitor_id, {
      downSeconds: Math.max(0, r.down_seconds || 0),
      incidents: r.incidents,
      ongoing: r.ongoing,
      mttrSeconds: r.mttr_seconds ? Math.round(r.mttr_seconds) : null,
      longestSeconds: r.longest_seconds ? Math.round(r.longest_seconds) : null,
    });
  }
  return map;
}

// Satu baris laporan untuk satu monitor
function buildRow(monitor, { from, to, now, stats }) {
  // Monitor yang baru dibuat di tengah rentang hanya dihitung sejak ia ada —
  // kalau tidak, waktu sebelum monitornya lahir akan terhitung sebagai "up".
  const start = Math.max(from.getTime(), new Date(monitor.created_at).getTime());
  const end = Math.min(to.getTime(), now.getTime());
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));

  const down = stats?.downSeconds ?? 0;
  const downSeconds = Math.min(Math.round(down), totalSeconds);
  const upSeconds = Math.max(0, totalSeconds - downSeconds);
  const uptime = totalSeconds > 0 ? (upSeconds / totalSeconds) * 100 : null;

  const target = monitor.slo_target ?? null;
  let budget = null;
  if (target !== null && totalSeconds > 0) {
    const allowedSeconds = Math.round(((100 - target) / 100) * totalSeconds);
    const remainingSeconds = allowedSeconds - downSeconds;
    budget = {
      target,
      allowed_seconds: allowedSeconds,
      used_seconds: downSeconds,
      remaining_seconds: remainingSeconds,
      // Berapa persen jatah yang sudah terpakai. >100 berarti target terlewat.
      used_percent: allowedSeconds > 0 ? Math.round((downSeconds / allowedSeconds) * 1000) / 10 : downSeconds > 0 ? 100 : 0,
      met: uptime !== null && uptime >= target,
    };
  }

  return {
    monitor_id: monitor.id,
    monitor: monitor.name,
    type: monitor.type,
    // Rentang yang benar-benar dipakai untuk monitor ini
    measured_from: new Date(start),
    measured_to: new Date(end),
    total_seconds: totalSeconds,
    down_seconds: downSeconds,
    uptime: uptime === null ? null : Math.round(uptime * 10000) / 10000,
    incidents: stats?.incidents ?? 0,
    ongoing_incidents: stats?.ongoing ?? 0,
    mttr_seconds: stats?.mttrSeconds ?? null,
    longest_incident_seconds: stats?.longestSeconds ?? null,
    slo_target: target,
    error_budget: budget,
  };
}

// Laporan SLA untuk sebuah rentang. `monitorId` opsional untuk satu monitor saja.
export async function slaReport({ from, to, monitorId = null, excludeMaintenance = config.slaExcludeMaintenance } = {}) {
  const now = new Date();
  const where = monitorId ? { id: Number(monitorId) } : {};
  const monitors = await prisma.monitor.findMany({
    where,
    select: { id: true, name: true, type: true, created_at: true, slo_target: true },
    orderBy: { name: "asc" },
  });
  const stats = await downtimeMap(from, to, { excludeMaintenance });

  const rows = monitors
    .map((m) => buildRow(m, { from, to, now, stats: stats.get(m.id) }))
    // Monitor yang dibuat setelah rentang berakhir tidak punya apa pun untuk dilaporkan
    .filter((r) => r.total_seconds > 0);

  const measured = rows.filter((r) => r.uptime !== null);
  const withTarget = rows.filter((r) => r.error_budget);
  const summary = {
    from,
    to,
    monitors: rows.length,
    // Rata-rata sederhana antar monitor, bukan ditimbang durasi: tiap layanan
    // dianggap sama pentingnya kecuali ditetapkan lain lewat target masing-masing.
    uptime: measured.length ? Math.round((measured.reduce((s, r) => s + r.uptime, 0) / measured.length) * 10000) / 10000 : null,
    total_down_seconds: rows.reduce((s, r) => s + r.down_seconds, 0),
    incidents: rows.reduce((s, r) => s + r.incidents, 0),
    with_target: withTarget.length,
    meeting_target: withTarget.filter((r) => r.error_budget.met).length,
    breaching_target: withTarget.filter((r) => !r.error_budget.met).length,
    exclude_maintenance: excludeMaintenance,
  };
  return { summary, rows };
}

// Deret bulanan untuk melihat tren, mis. 12 bulan terakhir
export async function monthlySeries({ months = 12, monitorId = null, excludeMaintenance = config.slaExcludeMaintenance } = {}) {
  const count = Math.min(36, Math.max(1, Number(months) || 12));
  const now = new Date();
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const { from, to } = monthRange(new Date(now.getFullYear(), now.getMonth() - i, 1));
    const { summary, rows } = await slaReport({ from, to, monitorId, excludeMaintenance });
    out.push({
      month: monthKey(from),
      uptime: monitorId ? (rows[0]?.uptime ?? null) : summary.uptime,
      down_seconds: summary.total_down_seconds,
      incidents: summary.incidents,
      breaching_target: summary.breaching_target,
    });
  }
  return out;
}

// Durasi ringkas untuk CSV & UI, mis. "2h 15m" atau "48s"
export function humanDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (s < 60) return `${s}s`;
  const days = Math.floor(s / SECONDS_PER_DAY);
  const hours = Math.floor((s % SECONDS_PER_DAY) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days) return `${days}h ${hours}j`;
  if (hours) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}
