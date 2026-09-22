import tls from "node:tls";

// Ambil info sertifikat TLS dari host tanpa memvalidasi rantai — tujuan kita
// mengetahui tanggal kedaluwarsa, bukan menolak koneksi. Masalah validasi
// tetap dilaporkan lewat `authorized` / `error`.
export function fetchCertInfo({ hostname, port = 443, timeoutSeconds = 10 }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(value);
    };

    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: timeoutSeconds * 1000 },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) return finish({ ok: false, error: "Sertifikat tidak terbaca" });
        const validTo = new Date(cert.valid_to);
        finish({
          ok: true,
          valid_from: new Date(cert.valid_from),
          valid_to: validTo,
          days_remaining: Math.floor((validTo.getTime() - Date.now()) / 86400_000),
          issuer: cert.issuer?.O || cert.issuer?.CN || null,
          subject: cert.subject?.CN || hostname,
          authorized: socket.authorized,
          authorization_error: socket.authorized ? null : String(socket.authorizationError || ""),
        });
      }
    );
    socket.once("timeout", () => finish({ ok: false, error: `Timeout handshake TLS setelah ${timeoutSeconds}s` }));
    socket.once("error", (err) => finish({ ok: false, error: err.code || err.message }));
  });
}

// Hostname & port TLS dari sebuah monitor http(s). null jika bukan https.
export function tlsTarget(monitor) {
  if (monitor.type !== "http" || !monitor.url) return null;
  try {
    const u = new URL(monitor.url);
    if (u.protocol !== "https:") return null;
    return { hostname: u.hostname, port: Number(u.port) || 443 };
  } catch {
    return null;
  }
}
