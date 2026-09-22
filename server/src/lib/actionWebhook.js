import { prisma } from "../db.js";
import { config } from "../config.js";
import { monitorTarget } from "../notifications/index.js";

// Webhook aksi: dipanggil untuk MEMICU otomasi di sistem lain (restart service,
// buka ticket), berbeda dari notifikasi yang sekadar mengabari manusia.
// Setiap percobaan dicatat di webhook_logs agar kegagalan bisa ditelusuri.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLOCKED_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade"]);

function buildHeaders(monitor) {
  const headers = { "Content-Type": "application/json", "User-Agent": "Pulsewatch/2.0 (+automation webhook)" };
  const custom = monitor.action_webhook_headers;
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    for (const [k, v] of Object.entries(custom)) {
      const name = String(k).trim();
      if (name && !BLOCKED_HEADERS.has(name.toLowerCase())) headers[name] = String(v ?? "");
    }
  }
  return headers;
}

export function buildPayload(monitor, event, { incident, heartbeat } = {}) {
  return {
    event: `monitor.${event}`,
    triggered_at: new Date().toISOString(),
    monitor: {
      id: monitor.id,
      name: monitor.name,
      type: monitor.type,
      target: monitorTarget(monitor),
      interval_seconds: monitor.interval_seconds,
    },
    incident: incident ? { id: incident.id, started_at: incident.started_at, cause: incident.cause } : null,
    heartbeat: heartbeat ? { status: heartbeat.status, message: heartbeat.message, response_time: heartbeat.response_time, created_at: heartbeat.created_at } : null,
    // Alamat untuk melapor balik setelah otomasi selesai dijalankan
    callback: `${config.baseUrl}/api/webhook/trigger/${monitor.id}`,
  };
}

async function attempt(monitor, url, method, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.actionWebhookTimeoutSeconds * 1000);
  const started = performance.now();
  try {
    const hasBody = method !== "GET";
    const res = await fetch(url, {
      method,
      headers: buildHeaders(monitor),
      body: hasBody ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
    return { ok: res.ok, status_code: res.status, duration_ms: Math.round(performance.now() - started), error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    const message = err.name === "AbortError" ? `Timeout setelah ${config.actionWebhookTimeoutSeconds}s` : err.cause?.code || err.message;
    return { ok: false, status_code: null, duration_ms: Math.round(performance.now() - started), error: String(message).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

export const wantsAction = (monitor, event) =>
  !!monitor.action_webhook_url && (event === "down" ? monitor.action_on_down : monitor.action_on_recover);

// Panggil webhook aksi dengan retry berjenjang. Tidak pernah melempar —
// kegagalan otomasi tidak boleh menjatuhkan scheduler.
export async function triggerActionWebhook(monitor, event, { incident, heartbeat } = {}) {
  if (!wantsAction(monitor, event)) return null;

  const url = monitor.action_webhook_url;
  const method = ["POST", "GET", "PUT"].includes(monitor.action_webhook_method) ? monitor.action_webhook_method : "POST";
  const payload = buildPayload(monitor, event, { incident, heartbeat });
  const attempts = Math.max(1, config.actionWebhookAttempts);

  let last = null;
  for (let i = 1; i <= attempts; i++) {
    const result = await attempt(monitor, url, method, payload);
    last = result;

    await prisma.webhookLog
      .create({
        data: {
          monitor_id: monitor.id,
          incident_id: incident?.id ?? null,
          event, url, method, attempt: i,
          ok: result.ok, status_code: result.status_code,
          error: result.error, duration_ms: result.duration_ms,
        },
      })
      .catch((e) => console.error("[action-webhook] gagal menulis log:", e.message));

    if (result.ok) {
      if (i > 1) console.log(`[action-webhook] monitor #${monitor.id} berhasil pada percobaan ${i}`);
      return result;
    }
    if (i < attempts) {
      const delay = 1000 * 3 ** (i - 1); // 1s, 3s, 9s
      console.warn(`[action-webhook] monitor #${monitor.id} gagal (${i}/${attempts}): ${result.error} — ulangi dalam ${delay / 1000}s`);
      await sleep(delay);
    }
  }
  console.error(`[action-webhook] monitor #${monitor.id} gagal setelah ${attempts} percobaan: ${last?.error}`);
  return last;
}
