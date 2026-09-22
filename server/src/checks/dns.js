import dns from "node:dns/promises";

export async function checkDns(monitor) {
  const start = performance.now();
  const type = (monitor.dns_resolve_type || "A").toUpperCase();
  try {
    const records = await dns.resolve(monitor.hostname, type);
    const ms = Math.round(performance.now() - start);
    const flat = records.map((r) => (typeof r === "object" ? JSON.stringify(r) : String(r)));
    if (monitor.dns_expected && !flat.some((r) => r.includes(monitor.dns_expected))) {
      return { ok: false, ms, message: `Record ${type} tidak mengandung "${monitor.dns_expected}": ${flat.join(", ")}` };
    }
    return { ok: true, ms, message: `${type}: ${flat.join(", ")}` };
  } catch (err) {
    return { ok: false, ms: Math.round(performance.now() - start), message: err.code || err.message };
  }
}
