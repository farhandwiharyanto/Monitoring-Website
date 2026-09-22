import { spawn } from "node:child_process";

// Pakai binary `ping` sistem (tersedia di Linux/macOS/alpine)
export function checkPing(monitor) {
  return new Promise((resolve) => {
    const timeout = Math.max(1, Math.min(monitor.timeout_seconds, 30));
    const isMac = process.platform === "darwin";
    const args = isMac
      ? ["-c", "1", "-W", String(timeout * 1000), monitor.hostname]
      : ["-c", "1", "-W", String(timeout), monitor.hostname];
    const start = performance.now();
    let out = "";
    const child = spawn("ping", args);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => resolve({ ok: false, ms: 0, message: err.message }));
    child.on("close", (code) => {
      const m = out.match(/time[=<]([\d.]+)\s*ms/);
      const ms = m ? Math.round(parseFloat(m[1])) : Math.round(performance.now() - start);
      if (code === 0) resolve({ ok: true, ms, message: `Ping ${ms} ms` });
      else resolve({ ok: false, ms, message: out.trim().split("\n").pop() || "Host tidak menjawab" });
    });
  });
}
