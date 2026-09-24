import { Router } from "express";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { userFromToken } from "../lib/auth.js";
import { decorateMonitors, monitorInclude } from "../lib/stats.js";

// Exporter bergaya Prometheus (text/plain; version=0.0.4).
export const metricsRouter = Router();

// Scrape butuh METRICS_TOKEN, atau token login biasa. METRICS_PUBLIC=true
// membuka endpoint tanpa auth — hanya pantas bila sudah dibatasi di jaringan.
async function authorize(req) {
  if (config.metricsPublic) return true;
  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const token = bearer || (req.query.token ? String(req.query.token) : null);
  if (!token) return false;
  if (config.metricsToken && token === config.metricsToken) return true;
  return !!(await userFromToken(token));
}

// Nilai label Prometheus: backslash, kutip, dan newline harus di-escape
const label = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
const labels = (pairs) =>
  Object.entries(pairs)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${label(v)}"`)
    .join(",");

function metric(lines, name, help, type, samples) {
  if (samples.length === 0) return;
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
  for (const [tags, value] of samples) lines.push(`${name}{${tags}} ${value}`);
  lines.push("");
}

metricsRouter.get("/", async (req, res) => {
  if (!(await authorize(req))) {
    res.set("WWW-Authenticate", 'Bearer realm="pulsewatch-metrics"');
    return res.status(401).type("text/plain").send("# unauthorized: kirim Authorization: Bearer <METRICS_TOKEN>\n");
  }

  const started = performance.now();
  const raw = await prisma.monitor.findMany({ include: monitorInclude, orderBy: { id: "asc" } });
  const monitors = await decorateMonitors(raw, { beats: 1 });
  const openIncidents = await prisma.incident.count({ where: { resolved_at: null } });

  const lines = [];
  const base = (m) => ({ monitor_id: m.id, monitor: m.name, type: m.type });

  metric(lines, "pulsewatch_monitor_status",
    "Status monitor (0=down, 1=up, 2=pending, 3=paused, 4=maintenance) pada lokasi primary", "gauge",
    monitors.map((m) => [labels(base(m)), m.status]));

  metric(lines, "pulsewatch_monitor_up",
    "1 bila monitor up, 0 bila tidak (maintenance & paused dihitung 0)", "gauge",
    monitors.map((m) => [labels(base(m)), m.status === 1 ? 1 : 0]));

  metric(lines, "pulsewatch_monitor_response_time_ms",
    "Response time pengecekan terakhir dalam milidetik", "gauge",
    monitors.filter((m) => m.last_response_time != null).map((m) => [labels(base(m)), m.last_response_time]));

  metric(lines, "pulsewatch_monitor_last_check_timestamp_seconds",
    "Unix timestamp pengecekan terakhir", "gauge",
    monitors.filter((m) => m.last_check).map((m) => [labels(base(m)), Math.floor(new Date(m.last_check).getTime() / 1000)]));

  metric(lines, "pulsewatch_monitor_uptime_ratio",
    "Rasio uptime (0–1) pada jendela waktu tertentu", "gauge",
    monitors.flatMap((m) => [
      m.uptime_24h != null ? [labels({ ...base(m), window: "24h" }), (m.uptime_24h / 100).toFixed(4)] : null,
      m.uptime_30d != null ? [labels({ ...base(m), window: "30d" }), (m.uptime_30d / 100).toFixed(4)] : null,
    ].filter(Boolean)));

  // Per lokasi — inilah yang memperlihatkan satu lokasi down sementara lainnya up
  metric(lines, "pulsewatch_monitor_location_up",
    "1 bila monitor up menurut lokasi tersebut", "gauge",
    monitors.flatMap((m) => (m.locations || []).map((l) => [labels({ ...base(m), location: l.location }), l.status === 1 ? 1 : 0])));

  metric(lines, "pulsewatch_monitor_location_response_time_ms",
    "Response time terakhir per lokasi", "gauge",
    monitors.flatMap((m) => (m.locations || [])
      .filter((l) => l.response_time != null)
      .map((l) => [labels({ ...base(m), location: l.location }), l.response_time])));

  metric(lines, "pulsewatch_monitor_location_split",
    "1 bila lokasi tidak sepakat (sebagian up, sebagian down)", "gauge",
    monitors.map((m) => [labels(base(m)), m.location_split ? 1 : 0]));

  // Alert yang sedang ditahan karena induknya down — berguna untuk membedakan
  // "sunyi karena sehat" dari "sunyi karena sengaja didiamkan".
  metric(lines, "pulsewatch_monitor_alert_suppressed",
    "1 bila alert monitor ditahan karena monitor induknya sedang down", "gauge",
    monitors.map((m) => [labels({ ...base(m), blocked_by: m.blocked_by?.name }), m.alert_suppressed ? 1 : 0]));

  metric(lines, "pulsewatch_monitor_cert_expiry_timestamp_seconds",
    "Unix timestamp kedaluwarsa sertifikat TLS", "gauge",
    monitors.filter((m) => m.cert_expires_at)
      .map((m) => [labels({ ...base(m), issuer: m.cert_issuer }), Math.floor(new Date(m.cert_expires_at).getTime() / 1000)]));

  metric(lines, "pulsewatch_monitor_cert_days_remaining",
    "Sisa hari sebelum sertifikat TLS kedaluwarsa", "gauge",
    monitors.filter((m) => m.cert_expires_at)
      .map((m) => [labels(base(m)), Math.floor((new Date(m.cert_expires_at).getTime() - Date.now()) / 86400_000)]));

  metric(lines, "pulsewatch_monitor_cert_chain_valid",
    "1 bila rantai sertifikat tervalidasi pada pemeriksaan terakhir", "gauge",
    monitors.filter((m) => m.cert_chain_valid !== null && m.cert_chain_valid !== undefined)
      .map((m) => [labels(base(m)), m.cert_chain_valid ? 1 : 0]));

  metric(lines, "pulsewatch_monitor_assertion_ok",
    "1 bila body assertion terakhir lulus", "gauge",
    monitors.filter((m) => m.last_assertion_ok !== null && m.last_assertion_ok !== undefined)
      .map((m) => [labels(base(m)), m.last_assertion_ok ? 1 : 0]));

  const byStatus = { down: 0, up: 1, pending: 2, paused: 3, maintenance: 4 };
  metric(lines, "pulsewatch_monitors_total", "Jumlah monitor per status", "gauge",
    Object.entries(byStatus).map(([name, code]) => [labels({ status: name }), monitors.filter((m) => m.status === code).length]));

  metric(lines, "pulsewatch_open_incidents", "Jumlah incident yang belum selesai", "gauge",
    [[labels({ instance: config.locationName }), openIncidents]]);

  metric(lines, "pulsewatch_scrape_duration_seconds", "Lama penyusunan metrik ini", "gauge",
    [[labels({ instance: config.locationName }), ((performance.now() - started) / 1000).toFixed(4)]]);

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(lines.join("\n"));
});
