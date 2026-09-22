import nodemailer from "nodemailer";
import { prisma } from "../db.js";
import { config } from "../config.js";

const providers = {
  async telegram(cfg, { title, body }) {
    const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text: `*${title}*\n${body}`, parse_mode: "Markdown" }),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  },

  async discord(cfg, { title, body, status }) {
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Pulsewatch",
        embeds: [{ title, description: body, color: status === "up" ? 0x22c55e : status === "down" ? 0xef4444 : 0x64748b }],
      }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
  },

  async email(cfg, { title, body }) {
    const transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: Number(cfg.smtpPort || 587),
      secure: cfg.secure === true || cfg.secure === "true",
      auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined,
    });
    await transporter.sendMail({ from: cfg.from, to: cfg.to, subject: title, text: body });
  },

  async webhook(cfg, payload) {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cfg.headers || {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Webhook ${res.status}`);
  },
};

export async function sendNotification(notification, payload) {
  const fn = providers[notification.type];
  if (!fn) throw new Error(`Tipe notifikasi tidak dikenal: ${notification.type}`);
  const cfg = typeof notification.config === "string" ? JSON.parse(notification.config) : notification.config || {};
  await fn(cfg, payload);
}

// Kirim ke semua notifikasi yang terhubung ke monitor (plus yang is_default)
export async function notifyMonitorEvent(monitor, status, heartbeat, incident) {
  try {
    const list = await prisma.notification.findMany({
      where: { OR: [{ is_default: true }, { monitors: { some: { monitor_id: monitor.id } } }] },
    });
    if (list.length === 0) return;

    const target = monitor.url || `${monitor.hostname}${monitor.port ? ":" + monitor.port : ""}`;
    const emoji = status === "up" ? "✅" : "🔴";
    const title = `${emoji} [Pulsewatch] ${monitor.name} is ${status.toUpperCase()}`;
    let body = `Monitor: ${monitor.name}\nTarget: ${target}\nPesan: ${heartbeat.message}\nWaktu: ${new Date().toISOString()}`;
    if (status === "up" && incident?.started_at) {
      const durSec = Math.round((Date.now() - new Date(incident.started_at).getTime()) / 1000);
      body += `\nDurasi down: ${formatDuration(durSec)}`;
    }
    body += `\n${config.baseUrl}/monitors/${monitor.id}`;

    const payload = { event: `monitor.${status}`, title, body, status, monitor: { id: monitor.id, name: monitor.name, type: monitor.type, target }, heartbeat };
    await Promise.allSettled(
      list.map((n) => sendNotification(n, payload).catch((err) => console.error(`[notify] ${n.type}#${n.id} gagal:`, err.message)))
    );
  } catch (err) {
    console.error("[notify]", err);
  }
}

export function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h < 24 ? `${h}h ${m}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
