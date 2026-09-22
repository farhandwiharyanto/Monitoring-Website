import { config, allowedOrigins } from "../config.js";

// Header keamanan dasar (pengganti ringan helmet — tanpa dependency tambahan).
export function securityHeaders(req, res, next) {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "DENY");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Cross-Origin-Opener-Policy", "same-origin");
  res.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  res.set("X-DNS-Prefetch-Control", "off");
  if (config.isProd && config.baseUrl.startsWith("https://")) {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // CSP untuk SPA: script hanya dari origin sendiri, font/gaya dari Google Fonts,
  // gambar boleh dari https mana pun (logo status page), websocket ke origin sendiri.
  res.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  next();
}

// CORS: endpoint /api/public/* terbuka (status page boleh di-embed),
// sisanya hanya untuk origin yang terdaftar.
export function corsPolicy(req, res, next) {
  const origin = req.headers.origin;
  const isPublic = req.path.startsWith("/api/public/");
  if (isPublic) {
    res.set("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins().includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Credentials", "true");
  }
  res.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}
