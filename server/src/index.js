import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import { config, allowedOrigins, isPrimaryLocation } from "./config.js";
import { initDb } from "./db.js";
import { userFromToken, denyApiKey } from "./lib/auth.js";
import { securityHeaders, corsPolicy } from "./lib/security.js";
import { initScheduler } from "./scheduler.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { monitorsRouter } from "./routes/monitors.js";
import { notificationsRouter } from "./routes/notifications.js";
import { statusPagesRouter, publicStatusRouter } from "./routes/statusPages.js";
import { tagsRouter } from "./routes/tags.js";
import { maintenanceRouter } from "./routes/maintenance.js";
import { pushRouter } from "./routes/push.js";
import { settingsRouter } from "./routes/settings.js";
import { exportRouter } from "./routes/export.js";
import { metricsRouter } from "./routes/metrics.js";
import { apiKeysRouter } from "./routes/apiKeys.js";
import { webhookRouter } from "./routes/webhook.js";
import { incidentsRouter } from "./routes/incidents.js";
import { auditRouter } from "./routes/audit.js";
import { reportsRouter } from "./routes/reports.js";
import { oncallRouter, ackRouter } from "./routes/oncall.js";

// Mode worker (WORKER_ONLY=true): hanya menjalankan scheduler dan menulis
// heartbeat berlabel LOCATION_NAME ke database yang sama. Tidak membuka HTTP.
if (config.workerOnly) {
  await initDb({ seedAdmin: false });
  initScheduler(null);
  console.log(`[pulsewatch] worker berjalan — lokasi "${config.locationName}" (primary: ${config.primaryLocation})`);
  if (isPrimaryLocation()) {
    console.warn("[pulsewatch] PERHATIAN: worker memakai nama lokasi yang sama dengan primary — set LOCATION_NAME ke nama lain.");
  }
} else {
  await startServer();
}

async function startServer() {
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins(), credentials: true } });

// Di belakang reverse proxy, req.ip mengikuti X-Forwarded-For (dipakai rate limit)
if (config.trustProxy) app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(securityHeaders);
app.use(corsPolicy);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, name: "pulsewatch", time: new Date().toISOString() }));
app.use("/api/auth", authRouter);
// Manajemen user & kredensial notifikasi hanya untuk manusia yang login:
// API key tidak boleh dipakai menaikkan hak aksesnya sendiri.
app.use("/api/users", denyApiKey, usersRouter);
app.use("/api/api-keys", apiKeysRouter);
app.use("/api/monitors", monitorsRouter);
app.use("/api/notifications", denyApiKey, notificationsRouter);
app.use("/api/incidents", incidentsRouter);
// Audit log hanya dibaca admin yang login (router-nya sudah menolak API key)
app.use("/api/audit-logs", auditRouter);
app.use("/api/reports", reportsRouter);
// Tautan acknowledge di pesan notifikasi dibuka tanpa login, jadi dipasang
// SEBELUM /api/oncall yang ber-auth — Express memilih route sesuai urutan.
app.use("/api/oncall/ack", ackRouter);
// Jadwal on-call & escalation policy menyimpan siapa dikabari lewat kontak apa,
// jadi diperlakukan sama dengan notifikasi: bukan untuk API key.
app.use("/api/oncall", denyApiKey, oncallRouter);
app.use("/api/webhook", webhookRouter);
app.use("/api/status-pages", statusPagesRouter);
app.use("/api/public/status", publicStatusRouter);
app.use("/api/push", pushRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/export", exportRouter);
// Prometheus meng-scrape /metrics (di luar /api agar konfigurasinya lazim)
app.use("/metrics", metricsRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/maintenance", maintenanceRouter);

// Route API yang tidak dikenal jangan jatuh ke SPA fallback
app.use("/api", (req, res) => res.status(404).json({ error: "Endpoint tidak ditemukan" }));

// Socket.io: client yang membawa token valid bergabung ke room "admin" (data internal).
// Data sensitif (mis. push token) tidak pernah disiarkan lewat room ini.
io.use(async (socket, next) => {
  socket.data.user = await userFromToken(socket.handshake.auth?.token);
  next();
});
io.on("connection", (socket) => {
  if (socket.data.user) socket.join("admin");
  socket.on("authenticate", async (t, ack) => {
    const user = await userFromToken(t);
    socket.data.user = user;
    if (user) { socket.join("admin"); ack?.({ ok: true }); } else { socket.leave("admin"); ack?.({ ok: false }); }
  });
});

// Serve build React di production (single container)
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { maxAge: "1h", index: false }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
}

app.use((err, req, res, next) => {
  console.error(err);
  // Pesan internal tidak dibocorkan ke client di production
  res.status(500).json({ error: config.isProd ? "Terjadi kesalahan pada server" : err.message || "Internal error" });
});

await initDb();
// Instance web juga menjalankan scheduler untuk lokasinya sendiri
initScheduler(io);
server.listen(config.port, () => {
  console.log(`[pulsewatch] http://localhost:${config.port}`);
  console.log(`[pulsewatch] lokasi "${config.locationName}"${isPrimaryLocation() ? " (primary)" : ` — primary: ${config.primaryLocation}`}`);
});
}
