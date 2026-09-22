import express from "express";
import http from "node:http";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import { config } from "./config.js";
import { initDb } from "./db.js";
import { verifyToken } from "./lib/auth.js";
import { initScheduler } from "./scheduler.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { monitorsRouter } from "./routes/monitors.js";
import { notificationsRouter } from "./routes/notifications.js";
import { statusPagesRouter, publicStatusRouter } from "./routes/statusPages.js";
import { tagsRouter } from "./routes/tags.js";
import { maintenanceRouter } from "./routes/maintenance.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, name: "pulsewatch", time: new Date().toISOString() }));
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/monitors", monitorsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/status-pages", statusPagesRouter);
app.use("/api/public/status", publicStatusRouter);
app.use("/api/tags", tagsRouter);
app.use("/api/maintenance", maintenanceRouter);

// Socket.io: client admin/viewer mengirim token untuk bergabung ke room "admin" (data internal)
io.on("connection", (socket) => {
  const token = socket.handshake.auth?.token;
  if (token && verifyToken(token)) socket.join("admin");
  socket.on("authenticate", (t, ack) => {
    if (verifyToken(t)) { socket.join("admin"); ack?.({ ok: true }); } else ack?.({ ok: false });
  });
});

// Serve build React di production (single container)
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal error" });
});

await initDb();
initScheduler(io);
server.listen(config.port, () => console.log(`[pulsewatch] http://localhost:${config.port}`));
