import nodemailer from "nodemailer";
import { prisma } from "../db.js";
import { config } from "../config.js";

export const NOTIFICATION_TYPES = ["telegram", "discord", "slack", "googlechat", "ntfy", "email", "webhook"];

// Warna status dipakai beberapa provider (Discord/Slack) untuk aksen pesan
const COLOR = { up: 0x22c55e, down: 0xef4444, cert: 0xf59e0b, test: 0x64748b };
const HEX = { up: "#22c55e", down: "#ef4444", cert: "#f59e0b", test: "#64748b" };
const tone = (status) => (status in COLOR ? status : "test");

// Fetch dengan timeout supaya provider yang menggantung tidak menahan scheduler
async function postJson(url, body, { headers = {}, timeoutSeconds = 15, label } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${label} ${res.status}: ${text.slice(0, 200)}`);
    }
    return res;
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`${label}: timeout setelah ${timeoutSeconds}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const providers = {
  async telegram(cfg, { title, body }) {
    if (!cfg.botToken || !cfg.chatId) throw new Error("Telegram: botToken & chatId wajib diisi");
    await postJson(
      `https://api.telegram.org/bot${cfg.botToken}/sendMessage`,
      { chat_id: cfg.chatId, text: `*${title}*\n${body}`, parse_mode: "Markdown", ...(cfg.threadId ? { message_thread_id: Number(cfg.threadId) } : {}) },
      { label: "Telegram" }
    );
  },

  async discord(cfg, { title, body, status }) {
    if (!cfg.webhookUrl) throw new Error("Discord: webhookUrl wajib diisi");
    await postJson(
      cfg.webhookUrl,
      { username: cfg.username || "Pulsewatch", embeds: [{ title, description: body, color: COLOR[tone(status)] }] },
      { label: "Discord" }
    );
  },

  // Slack incoming webhook — pakai attachment agar ada garis warna status
  async slack(cfg, { title, body, status, monitor }) {
    if (!cfg.webhookUrl) throw new Error("Slack: webhookUrl wajib diisi");
    await postJson(
      cfg.webhookUrl,
      {
        ...(cfg.channel ? { channel: cfg.channel } : {}),
        username: cfg.username || "Pulsewatch",
        icon_emoji: cfg.iconEmoji || ":heartbeat:",
        text: title,
        attachments: [
          {
            color: HEX[tone(status)],
            title,
            text: body,
            ...(monitor ? { footer: `Pulsewatch · ${monitor.name}` } : {}),
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      },
      { label: "Slack" }
    );
  },

  // Google Chat incoming webhook (spaces/.../messages?key=...&token=...)
  async googlechat(cfg, { title, body }) {
    if (!cfg.webhookUrl) throw new Error("Google Chat: webhookUrl wajib diisi");
    await postJson(cfg.webhookUrl, { text: `*${title}*\n${body}` }, { label: "Google Chat" });
  },

  // ntfy.sh atau instance ntfy sendiri — body plain text, metadata lewat header
  async ntfy(cfg, { title, body, status }) {
    if (!cfg.topic) throw new Error("ntfy: topic wajib diisi");
    const base = String(cfg.serverUrl || "https://ntfy.sh").replace(/\/+$/, "");
    const headers = {
      "Content-Type": "text/plain; charset=utf-8",
      Title: title.replace(/[^\x20-\x7E]/g, "").trim() || "Pulsewatch",
      Priority: String(cfg.priority || (status === "down" ? 5 : 3)),
      Tags: status === "up" ? "white_check_mark" : status === "down" ? "rotating_light" : "warning",
    };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    else if (cfg.username) headers.Authorization = `Basic ${Buffer.from(`${cfg.username}:${cfg.password || ""}`).toString("base64")}`;
    await postJson(`${base}/${encodeURIComponent(cfg.topic)}`, body, { headers, label: "ntfy" });
  },

  async email(cfg, { title, body }) {
    if (!cfg.smtpHost || !cfg.to) throw new Error("Email: smtpHost & to wajib diisi");
    const transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: Number(cfg.smtpPort || 587),
      secure: cfg.secure === true || cfg.secure === "true",
      auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass } : undefined,
    });
    await transporter.sendMail({ from: cfg.from || cfg.smtpUser, to: cfg.to, subject: title, text: body });
  },

  async webhook(cfg, payload) {
    if (!cfg.url) throw new Error("Webhook: url wajib diisi");
    await postJson(cfg.url, payload, { headers: cfg.headers || {}, label: "Webhook" });
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kirim satu notifikasi. `attempts` > 1 akan mengulang dengan jeda menaik —
// berguna saat provider sedang 5xx atau jaringan sesaat terputus.
export async function sendNotification(notification, payload, { attempts = 1 } = {}) {
  const fn = providers[notification.type];
  if (!fn) throw new Error(`Tipe notifikasi tidak dikenal: ${notification.type}`);
  const cfg = typeof notification.config === "string" ? JSON.parse(notification.config) : notification.config || {};

  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await fn(cfg, payload);
      if (i > 1) console.log(`[notify] ${notification.type}#${notification.id ?? "-"} berhasil pada percobaan ${i}`);
      return;
    } catch (err) {
      lastErr = err;
      // Kesalahan konfigurasi tidak akan membaik dengan diulang
      if (/wajib diisi|tidak dikenal/.test(err.message) || i === attempts) break;
      const delay = 1000 * 3 ** (i - 1); // 1s, 3s, 9s
      console.warn(`[notify] ${notification.type}#${notification.id ?? "-"} gagal (percobaan ${i}/${attempts}): ${err.message} — ulangi dalam ${delay / 1000}s`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Daftar notifikasi yang berlaku untuk sebuah monitor (terhubung langsung + default)
function notificationsFor(monitorId) {
  return prisma.notification.findMany({
    where: { OR: [{ is_default: true }, { monitors: { some: { monitor_id: monitorId } } }] },
  });
}

async function fanout(monitorId, payload) {
  const list = await notificationsFor(monitorId);
  if (list.length === 0) return;
  await Promise.allSettled(
    list.map((n) =>
      sendNotification(n, payload, { attempts: 3 }).catch((err) => console.error(`[notify] ${n.type}#${n.id} gagal: ${err.message}`))
    )
  );
}

export const monitorTarget = (monitor) =>
  monitor.url || `${monitor.hostname || ""}${monitor.port ? ":" + monitor.port : ""}` || monitor.name;

// Alert naik/turunnya sebuah monitor
export async function notifyMonitorEvent(monitor, status, heartbeat, incident) {
  try {
    const target = monitorTarget(monitor);
    const emoji = status === "up" ? "✅" : "🔴";
    const title = `${emoji} [Pulsewatch] ${monitor.name} is ${status.toUpperCase()}`;
    let body = `Monitor: ${monitor.name}\nTarget: ${target}\nPesan: ${heartbeat.message}\nWaktu: ${new Date().toISOString()}`;
    if (status === "up" && incident?.started_at) {
      body += `\nDurasi down: ${formatDuration(Math.round((Date.now() - new Date(incident.started_at).getTime()) / 1000))}`;
    }
    body += `\n${config.baseUrl}/monitors/${monitor.id}`;

    await fanout(monitor.id, {
      event: `monitor.${status}`,
      title,
      body,
      status,
      monitor: { id: monitor.id, name: monitor.name, type: monitor.type, target },
      heartbeat,
    });
  } catch (err) {
    console.error("[notify]", err);
  }
}

// Paging satu tingkat eskalasi. Berbeda dari notifyMonitorEvent yang menyiarkan
// ke semua channel monitor: ini dikirim ke SATU notifikasi saja — sasaran
// tingkat itu. Kegagalannya dilempar supaya pemanggil bisa mencatatnya sebagai
// delivery yang gagal, bukan ditelan diam-diam.
export async function notifyEscalation(notification, { monitor, incident, level, levelCount, delayMinutes, targetLabel, ackUrl }) {
  const target = monitorTarget(monitor);
  const downSeconds = incident?.started_at
    ? Math.round((Date.now() - new Date(incident.started_at).getTime()) / 1000)
    : null;

  const title = `🚨 [Pulsewatch] Eskalasi ${level}/${levelCount} — ${monitor.name} masih DOWN`;
  let body =
    `Monitor: ${monitor.name}\nTarget: ${target}\n` +
    `Penyebab: ${incident?.cause || "-"}\n`;
  if (downSeconds !== null) body += `Sudah down: ${formatDuration(downSeconds)}\n`;
  body += `Tingkat: ${level} dari ${levelCount} (jeda ${delayMinutes} menit)\n`;
  body += `Dikirim ke: ${targetLabel}\n`;
  // Tautan ack menghentikan sisa rantai tanpa perlu login — halamannya masih
  // meminta konfirmasi, jadi pratinjau tautan di aplikasi chat tidak ikut meng-ack.
  if (ackUrl) body += `\nSaya tangani (acknowledge): ${ackUrl}\n`;
  body += `${config.baseUrl}/monitors/${monitor.id}`;

  await sendNotification(notification, {
    event: "monitor.escalation",
    title,
    body,
    status: "down",
    monitor: { id: monitor.id, name: monitor.name, type: monitor.type, target },
    escalation: {
      incident_id: incident?.id ?? null,
      level,
      level_count: levelCount,
      delay_minutes: delayMinutes,
      target: targetLabel,
      ack_url: ackUrl || null,
    },
  }, { attempts: 3 });
}

// Peringatan sertifikat TLS yang hampir kedaluwarsa
export async function notifyCertExpiry(monitor, cert) {
  try {
    const target = monitorTarget(monitor);
    const expired = cert.days_remaining <= 0;
    const title = expired
      ? `⛔ [Pulsewatch] Sertifikat ${monitor.name} SUDAH kedaluwarsa`
      : `⚠️ [Pulsewatch] Sertifikat ${monitor.name} kedaluwarsa dalam ${cert.days_remaining} hari`;
    let body =
      `Monitor: ${monitor.name}\nTarget: ${target}\n` +
      `Berlaku sampai: ${new Date(cert.valid_to).toISOString()}\n` +
      `Penerbit: ${cert.issuer || "-"}\n` +
      `Sisa: ${cert.days_remaining} hari`;
    if (cert.threshold) body += `\nAmbang peringatan: ${cert.threshold} hari`;
    if (cert.authorized === false) body += `\nRantai sertifikat TIDAK valid: ${cert.authorization_error || "tidak diketahui"}`;
    body += `\n${config.baseUrl}/monitors/${monitor.id}`;

    await fanout(monitor.id, {
      event: "monitor.cert_expiry",
      title,
      body,
      status: "cert",
      monitor: { id: monitor.id, name: monitor.name, type: monitor.type, target },
      cert: {
        valid_to: cert.valid_to, days_remaining: cert.days_remaining, issuer: cert.issuer,
        threshold: cert.threshold ?? null, chain_valid: cert.authorized ?? null,
      },
    });
  } catch (err) {
    console.error("[notify:cert]", err);
  }
}

export function formatDuration(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h < 24 ? `${h}h ${m}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
