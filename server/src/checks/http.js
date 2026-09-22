// HTTP(s) check: cek status code dalam range yang diharapkan + keyword opsional
function statusMatches(code, expected) {
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

export async function checkHttp(monitor) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeout_seconds * 1000);
  const start = performance.now();
  try {
    const res = await fetch(monitor.url, {
      method: monitor.method || "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Pulsewatch/1.0 (+uptime monitor)" },
    });
    const ms = Math.round(performance.now() - start);
    if (!statusMatches(res.status, monitor.expected_status_codes)) {
      return { ok: false, ms, message: `HTTP ${res.status} (expected ${monitor.expected_status_codes})` };
    }
    if (monitor.keyword) {
      const body = await res.text();
      if (!body.includes(monitor.keyword)) {
        return { ok: false, ms, message: `Keyword "${monitor.keyword}" tidak ditemukan` };
      }
    }
    return { ok: true, ms, message: `HTTP ${res.status}` };
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    const message = err.name === "AbortError" ? `Timeout setelah ${monitor.timeout_seconds}s` : err.cause?.code || err.message;
    return { ok: false, ms, message };
  } finally {
    clearTimeout(timer);
  }
}
