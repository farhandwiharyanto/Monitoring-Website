import { translate } from "./i18n.jsx";

export const STATUS = { DOWN: 0, UP: 1, PENDING: 2, PAUSED: 3, MAINTENANCE: 4 };

// Bahasa aktif disimpan di modul agar fungsi format tetap bisa dipanggil
// langsung (tanpa hook) dari komponen mana pun. I18nProvider yang menyetelnya.
let lang = "id";
export function setFormatLang(next) {
  lang = next || "id";
}
const t = (key, vars) => translate(lang, key, vars);
const locale = () => (lang === "en" ? "en-GB" : "id-ID");

export const statusMeta = {
  0: { key: "0", color: "text-down", bg: "bg-down", ring: "ring-down/30", dot: "bg-down" },
  1: { key: "1", color: "text-up", bg: "bg-up", ring: "ring-up/30", dot: "bg-up" },
  2: { key: "2", color: "text-pending", bg: "bg-pending", ring: "ring-pending/30", dot: "bg-pending" },
  3: { key: "3", color: "text-muted", bg: "bg-muted", ring: "ring-muted/30", dot: "bg-muted" },
  4: { key: "4", color: "text-maint", bg: "bg-maint", ring: "ring-maint/30", dot: "bg-maint" },
};
export const statusLabel = (status) => t(`status.${status in statusMeta ? status : 2}`);

// Terima ISO (Postgres/Prisma) maupun "YYYY-MM-DD HH:MM:SS" UTC (SQLite lama)
export const parseDate = (s) => (s ? new Date(s.includes("T") || s.endsWith("Z") ? s : s.replace(" ", "T") + "Z") : null);

export function fmtTime(s) {
  const d = parseDate(s);
  return d ? d.toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" }) : "-";
}
export function fmtClock(s) {
  const d = parseDate(s);
  return d ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "";
}
export function fmtDate(s) {
  const d = parseDate(s);
  return d ? d.toLocaleDateString(locale(), { dateStyle: "medium" }) : "-";
}
export function timeAgo(s) {
  const d = parseDate(s);
  if (!d) return "-";
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return t("time.agoS", { n: sec });
  if (sec < 3600) return t("time.agoM", { n: Math.floor(sec / 60) });
  if (sec < 86400) return t("time.agoH", { n: Math.floor(sec / 3600) });
  return t("time.agoD", { n: Math.floor(sec / 86400) });
}
export function fmtDuration(sec) {
  if (sec == null) return "-";
  const hSuffix = lang === "en" ? "h" : "j";
  const dSuffix = lang === "en" ? "d" : "h";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h < 24 ? `${h}${hSuffix} ${m}m` : `${Math.floor(h / 24)}${dSuffix} ${h % 24}${hSuffix}`;
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
  // Monitor push tidak punya target keluar; URL push-nya rahasia dan hanya
  // ditampilkan di kartu khusus pada halaman detail.
  if (m.type === "push") return t("form.typePushDesc");
  return m.port ? `${m.hostname}:${m.port}` : m.hostname;
}
// Untuk <input type="datetime-local">: nilai lokal tanpa zona
export function toLocalInput(d) {
  const x = d ? new Date(d) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}
// Sisa hari sampai sebuah tanggal (dipakai indikator sertifikat TLS)
export function daysUntil(s) {
  const d = parseDate(s);
  return d ? Math.floor((d.getTime() - Date.now()) / 86400_000) : null;
}
