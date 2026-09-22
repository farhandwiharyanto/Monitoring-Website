import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { activeMaintenanceMap } from "./maintenance.js";
import { decryptSecret } from "./crypto.js";

const HOUR = 3600_000;

// Status, uptime, dan incident selalu dihitung dari lokasi primary saja, supaya
// angka tetap sama seperti sebelum multi-location ada. Heartbeat lama yang
// ditulis tanpa label lokasi (location IS NULL) ikut dihitung sebagai primary.
const PRIMARY_ONLY = () => Prisma.sql`AND (location IS NULL OR location = ${config.primaryLocation})`;

// Uptime & rata-rata respons untuk banyak monitor sekaligus (heartbeat maintenance dikecualikan)
async function uptimeMap(ids, hours) {
  const map = new Map();
  if (ids.length === 0) return map;
  const since = new Date(Date.now() - hours * HOUR);
  const rows = await prisma.$queryRaw`
    SELECT monitor_id,
           COUNT(*) FILTER (WHERE status = 1)::int          AS up,
           COUNT(*) FILTER (WHERE status IN (0,1))::int     AS total,
           AVG(response_time) FILTER (WHERE status = 1)::float AS avg_ms
    FROM heartbeats
    WHERE monitor_id IN (${Prisma.join(ids)}) AND created_at >= ${since} AND maintenance = false
      ${PRIMARY_ONLY()}
    GROUP BY monitor_id`;
  for (const r of rows) {
    map.set(r.monitor_id, {
      uptime: r.total ? Math.round((r.up / r.total) * 10000) / 100 : null,
      avgMs: r.avg_ms ? Math.round(r.avg_ms) : null,
    });
  }
  return map;
}

// N heartbeat terakhir per monitor dalam satu query (window function)
async function lastBeatsMap(ids, limit) {
  const map = new Map(ids.map((id) => [id, []]));
  if (ids.length === 0) return map;
  const rows = await prisma.$queryRaw`
    SELECT id, monitor_id, status, message, response_time, important, maintenance, location,
           assertion_ok, assertion_message, created_at FROM (
      SELECT h.*, row_number() OVER (PARTITION BY monitor_id ORDER BY created_at DESC, id DESC) AS rn
      FROM heartbeats h WHERE monitor_id IN (${Prisma.join(ids)}) ${PRIMARY_ONLY()}
    ) t WHERE rn <= ${limit} ORDER BY created_at ASC, id ASC`;
  for (const r of rows) map.get(r.monitor_id).push(r);
  return map;
}

// Heartbeat terakhir per (monitor, lokasi) — dasar tampilan perbandingan lokasi.
// Lokasi yang tidak mengirim kabar lebih lama dari `staleAfterSeconds` ditandai basi.
export async function locationStatusMap(ids, { staleAfterSeconds = 600 } = {}) {
  const map = new Map(ids.map((id) => [id, []]));
  if (ids.length === 0) return map;
  const rows = await prisma.$queryRaw`
    SELECT monitor_id, location, status, response_time, message, created_at FROM (
      SELECT h.*, row_number() OVER (
        PARTITION BY monitor_id, COALESCE(location, ${config.primaryLocation})
        ORDER BY created_at DESC, id DESC
      ) AS rn
      FROM heartbeats h WHERE monitor_id IN (${Prisma.join(ids)})
    ) t WHERE rn = 1`;

  const now = Date.now();
  for (const r of rows) {
    const location = r.location || config.primaryLocation;
    const age = Math.round((now - new Date(r.created_at).getTime()) / 1000);
    map.get(r.monitor_id).push({
      location,
      is_primary: location === config.primaryLocation,
      status: r.status,
      response_time: r.response_time,
      message: r.message,
      last_check: r.created_at,
      stale: age > staleAfterSeconds,
    });
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.is_primary === b.is_primary ? a.location.localeCompare(b.location) : a.is_primary ? -1 : 1));
  }
  return map;
}

// Username dari kredensial Basic Auth tersimpan ("user:pass"); null untuk tipe lain
function basicAuthUsername(m) {
  if (m.auth_type !== "basic" || !m.auth_secret) return null;
  const secret = decryptSecret(m.auth_secret);
  return secret && secret.includes(":") ? secret.slice(0, secret.indexOf(":")) : null;
}

export const monitorInclude = {
  tags: { include: { tag: true } },
  notifications: { select: { notification_id: true } },
};

// Bentuk monitor untuk API: status terakhir, heartbeat, uptime, tag, maintenance, lokasi
export async function decorateMonitors(monitors, opts = {}) {
  const ids = monitors.map((m) => m.id);
  const [beats, d24, d30, maint, locs] = await Promise.all([
    lastBeatsMap(ids, opts.beats ?? 20),
    uptimeMap(ids, 24),
    uptimeMap(ids, 24 * 30),
    activeMaintenanceMap(ids),
    opts.locations === false ? Promise.resolve(new Map()) : locationStatusMap(ids),
  ]);
  return monitors.map((m) => {
    const hb = beats.get(m.id);
    const last = hb[hb.length - 1];
    const mw = maint.get(m.id);
    const { tags, notifications, auth_secret, ...rest } = m;
    // status: 0 down, 1 up, 2 pending, 3 paused, 4 maintenance
    const status = !m.active ? 3 : mw ? 4 : last ? last.status : 2;

    // Perbedaan antar lokasi: sebagian up, sebagian down → indikasi masalah
    // jaringan di salah satu lokasi, bukan service-nya yang mati.
    const locations = locs.get(m.id) || [];
    const fresh = locations.filter((l) => !l.stale);
    const split = fresh.length > 1 && fresh.some((l) => l.status === 1) && fresh.some((l) => l.status === 0);

    return {
      ...rest,
      status,
      underlying_status: last ? last.status : 2,
      in_maintenance: !!mw,
      maintenance_window: mw ? { id: mw.id, title: mw.title, end_at: mw.end_at, recurring: mw.recurring } : null,
      last_message: last?.message ?? null,
      last_response_time: last?.response_time ?? null,
      last_check: last?.created_at ?? null,
      last_assertion_ok: last?.assertion_ok ?? null,
      last_assertion_message: last?.assertion_message ?? null,
      heartbeats: hb,
      uptime_24h: d24.get(m.id)?.uptime ?? null,
      uptime_30d: d30.get(m.id)?.uptime ?? null,
      avg_response_24h: d24.get(m.id)?.avgMs ?? null,
      tags: (tags || []).map((t) => t.tag),
      notification_ids: (notifications || []).map((n) => n.notification_id),
      // auth_secret sudah dibuang di atas. Username Basic Auth bukan rahasia dan
      // dibutuhkan form untuk menampilkan kembali nilainya; password tidak pernah keluar.
      has_auth: !!m.auth_type && m.auth_type !== "none",
      auth_username: basicAuthUsername(m),
      locations,
      location_split: split,
    };
  });
}

export async function decorateMonitor(monitor, opts) {
  return (await decorateMonitors([monitor], opts))[0];
}

export async function findMonitor(id, opts) {
  const m = await prisma.monitor.findUnique({ where: { id: Number(id) }, include: monitorInclude });
  return m ? decorateMonitor(m, opts) : null;
}

export async function dashboardStats() {
  const raw = await prisma.monitor.findMany({ include: monitorInclude });
  const monitors = await decorateMonitors(raw, { beats: 1 });
  const count = (s) => monitors.filter((m) => m.status === s).length;
  const since = new Date(Date.now() - 24 * HOUR);
  const [{ avg }] = await prisma.$queryRaw`
    SELECT AVG(response_time)::float AS avg FROM heartbeats
    WHERE status = 1 AND maintenance = false AND created_at >= ${since} ${PRIMARY_ONLY()}`;
  const withUptime = monitors.filter((m) => m.uptime_24h !== null);
  const uptime24 = withUptime.length ? withUptime.reduce((s, m) => s + m.uptime_24h, 0) / withUptime.length : null;
  const openIncidents = await prisma.incident.count({ where: { resolved_at: null } });
  return {
    total: monitors.length, up: count(1), down: count(0), pending: count(2), paused: count(3), maintenance: count(4),
    avg_response_24h: avg ? Math.round(avg) : null,
    uptime_24h: uptime24 !== null ? Math.round(uptime24 * 100) / 100 : null,
    open_incidents: openIncidents,
    // Monitor yang hasilnya berbeda antar lokasi
    location_split: monitors.filter((m) => m.location_split).length,
  };
}

// Daftar lokasi yang pernah mengirim heartbeat (untuk filter di dashboard)
export async function knownLocations() {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(location, ${config.primaryLocation}) AS location,
           MAX(created_at) AS last_seen,
           COUNT(*)::int AS beats
    FROM heartbeats
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({
    location: r.location,
    is_primary: r.location === config.primaryLocation,
    last_seen: r.last_seen,
    beats: r.beats,
  }));
}
