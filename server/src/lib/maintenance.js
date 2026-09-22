import { prisma } from "../db.js";

const DAY = 86400_000;

// Apakah window ini aktif pada waktu `now`?
export function isWindowActive(w, now = new Date()) {
  if (!w.active) return false;
  const start = new Date(w.start_at);
  const end = new Date(w.end_at);
  if (w.recurring === "none" || !w.recurring) return now >= start && now <= end;

  const duration = end - start;
  if (duration <= 0 || now < start) return false;
  const days = (w.days_of_week || "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d !== "")
    .map(Number);
  const allowedDays = w.recurring === "weekly" ? (days.length ? days : [start.getDay()]) : null;

  // Kandidat: jam mulai yang sama pada 0..7 hari terakhir (window bisa melintasi tengah malam)
  for (let back = 0; back <= 7; back++) {
    const cand = new Date(now.getTime() - back * DAY);
    cand.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
    if (cand < start) continue;
    if (allowedDays && !allowedDays.includes(cand.getDay())) continue;
    if (now >= cand && now <= new Date(cand.getTime() + duration)) return true;
  }
  return false;
}

// Map monitor_id -> window aktif (atau null) untuk sekumpulan monitor
export async function activeMaintenanceMap(monitorIds, now = new Date()) {
  const map = new Map(monitorIds.map((id) => [id, null]));
  if (monitorIds.length === 0) return map;
  const windows = await prisma.maintenanceWindow.findMany({ where: { monitor_id: { in: monitorIds }, active: true } });
  for (const w of windows) {
    if (!map.get(w.monitor_id) && isWindowActive(w, now)) map.set(w.monitor_id, w);
  }
  return map;
}

export async function isInMaintenance(monitorId) {
  return (await activeMaintenanceMap([monitorId])).get(monitorId);
}

export function decorateWindow(w) {
  return { ...w, is_active: isWindowActive(w) };
}
