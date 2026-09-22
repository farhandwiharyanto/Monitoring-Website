export const STATUS = { DOWN: 0, UP: 1, PENDING: 2, PAUSED: 3, MAINTENANCE: 4 };

export const statusMeta = {
  0: { label: "Down", color: "text-down", bg: "bg-down", ring: "ring-down/30", dot: "bg-down" },
  1: { label: "Up", color: "text-up", bg: "bg-up", ring: "ring-up/30", dot: "bg-up" },
  2: { label: "Pending", color: "text-pending", bg: "bg-pending", ring: "ring-pending/30", dot: "bg-pending" },
  3: { label: "Paused", color: "text-muted", bg: "bg-slate-600", ring: "ring-slate-600/30", dot: "bg-slate-600" },
  4: { label: "Maintenance", color: "text-maint", bg: "bg-maint", ring: "ring-maint/30", dot: "bg-maint" },
};

// Terima ISO (Postgres/Prisma) maupun "YYYY-MM-DD HH:MM:SS" UTC (SQLite lama)
export const parseDate = (s) => (s ? new Date(s.includes("T") || s.endsWith("Z") ? s : s.replace(" ", "T") + "Z") : null);

export function fmtTime(s) {
  const d = parseDate(s);
  return d ? d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-";
}
export function fmtClock(s) {
  const d = parseDate(s);
  return d ? d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "";
}
export function timeAgo(s) {
  const d = parseDate(s);
  if (!d) return "-";
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s lalu`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m lalu`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}j lalu`;
  return `${Math.floor(sec / 86400)}h lalu`;
}
export function fmtDuration(sec) {
  if (sec == null) return "-";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h < 24 ? `${h}j ${m}m` : `${Math.floor(h / 24)}h ${h % 24}j`;
}
export function incidentDuration(inc) {
  const start = parseDate(inc.started_at);
  const end = inc.resolved_at ? parseDate(inc.resolved_at) : new Date();
  return Math.round((end - start) / 1000);
}
export const fmtPct = (v) => (v == null ? "—" : `${v.toFixed(2)}%`);
export const fmtMs = (v) => (v == null ? "—" : `${v} ms`);
export function monitorTarget(m) {
  if (m.type === "http") return m.url;
  return m.port ? `${m.hostname}:${m.port}` : m.hostname;
}
// Untuk <input type="datetime-local">: nilai lokal tanpa zona
export function toLocalInput(d) {
  const x = d ? new Date(d) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
export const DAY_NAMES = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
