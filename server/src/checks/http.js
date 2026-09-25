import { decryptSecret } from "../lib/crypto.js";
import { hasAssertion, runAssertion } from "../lib/assertion.js";

// HTTP(s) check: status code dalam range yang diharapkan, keyword opsional,
// dan assertion opsional terhadap body JSON.
export function statusMatches(code, expected) {
  return String(expected || "200-299")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((part) => {
      if (part.includes("-")) {
        const [lo, hi] = part.split("-").map(Number);
        return code >= lo && code <= hi;
      }
      return code === Number(part);
    });
}

// Header yang mengatur transport tidak boleh ditimpa dari konfigurasi monitor.
const BLOCKED_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "keep-alive", "upgrade"]);

export function buildHeaders(monitor) {
  const headers = { "User-Agent": "Pulsewatch/2.0 (+uptime monitor)" };

  const custom = monitor.http_headers;
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    for (const [k, v] of Object.entries(custom)) {
      const name = String(k).trim();
      if (!name || BLOCKED_HEADERS.has(name.toLowerCase())) continue;
      headers[name] = String(v ?? "");
    }
  }

  // Kredensial tersimpan terenkripsi; kalau gagal dibuka, request tetap jalan
  // tanpa auth supaya kegagalannya terlihat sebagai 401 di pesan heartbeat.
  if (monitor.auth_type === "basic" || monitor.auth_type === "bearer") {
    const secret = decryptSecret(monitor.auth_secret);
    if (secret) {
      headers.Authorization =
        monitor.auth_type === "basic" ? `Basic ${Buffer.from(secret).toString("base64")}` : `Bearer ${secret}`;
    }
  }
  return headers;
}

export async function checkHttp(monitor) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeout_seconds * 1000);
  const start = performance.now();
  // Body hanya dibaca bila memang dipakai, agar tidak mengunduh sia-sia
  const needsBody = !!monitor.keyword || hasAssertion(monitor);

  try {
    const res = await fetch(monitor.url, {
      method: monitor.method || "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: buildHeaders(monitor),
    });
    const ms = Math.round(performance.now() - start);

    if (!statusMatches(res.status, monitor.expected_status_codes)) {
      return { ok: false, ms, message: `HTTP ${res.status} (expected ${monitor.expected_status_codes})`, assertion: null };
    }

    let body = null;
    if (needsBody) {
      try {
        body = await res.text();
      } catch (err) {
        return { ok: false, ms, message: `Gagal membaca body: ${err.message}`, assertion: null };
      }
    }

    if (monitor.keyword && !body.includes(monitor.keyword)) {
      return { ok: false, ms, message: `Keyword "${monitor.keyword}" tidak ditemukan`, assertion: null };
    }

    // Hasil assertion selalu disimpan di heartbeat, lulus maupun tidak,
    // supaya bisa dipakai menelusuri kegagalan.
    if (hasAssertion(monitor)) {
      const assertion = runAssertion(monitor, body);
      return assertion.ok
        ? { ok: true, ms, message: `HTTP ${res.status} · ${assertion.message}`, assertion }
        : { ok: false, ms, message: `HTTP ${res.status} · ${assertion.message}`, assertion };
    }

    return { ok: true, ms, message: `HTTP ${res.status}`, assertion: null };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    const message = err.name === "AbortError" ? `Timeout setelah ${monitor.timeout_seconds}s` : err.cause?.code || err.message;
    return { ok: false, ms, message, assertion: null };
  } finally {
    clearTimeout(timer);
  }
}
