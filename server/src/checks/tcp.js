import net from "node:net";

export function checkTcp(monitor) {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = new net.Socket();
    const done = (ok, message) => {
      socket.destroy();
      resolve({ ok, ms: Math.round(performance.now() - start), message });
    };
    socket.setTimeout(monitor.timeout_seconds * 1000);
    socket.once("connect", () => done(true, `Port ${monitor.port} terbuka`));
    socket.once("timeout", () => done(false, "Timeout koneksi TCP"));
    socket.once("error", (err) => done(false, err.code || err.message));
    socket.connect(monitor.port, monitor.hostname);
  });
}
