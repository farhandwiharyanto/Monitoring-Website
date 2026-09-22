import { Router } from "express";
import { randomBytes } from "node:crypto";
import { prisma } from "../db.js";
import { STATUS } from "../lib/status.js";
import { applyResult } from "../scheduler.js";
import { simpleLimiter } from "../lib/ratelimit.js";

// Endpoint publik untuk monitor tipe `push`: cron job / script di sisi target
// memanggil URL ini setiap selesai berjalan. Tokennya yang jadi kredensial.
export const pushRouter = Router();

export const newPushToken = () => randomBytes(16).toString("hex");

// Longgar tapi tetap berbatas: 120 hit/menit per IP sudah jauh di atas kebutuhan normal
pushRouter.use(simpleLimiter({ max: 120, windowSeconds: 60, prefix: "push" }));

async function handlePush(req, res) {
  const token = String(req.params.token || "");
  if (!/^[a-f0-9]{32}$/.test(token)) return res.status(404).json({ error: "Token tidak dikenal" });

  const monitor = await prisma.monitor.findUnique({ where: { push_token: token } });
  if (!monitor || monitor.type !== "push") return res.status(404).json({ error: "Token tidak dikenal" });
  if (!monitor.active) return res.json({ ok: true, ignored: "monitor sedang dijeda" });

  const q = { ...req.query, ...(req.body || {}) };
  const status = String(q.status || "up").toLowerCase() === "down" ? STATUS.DOWN : STATUS.UP;
  const message = String(q.msg || q.message || (status === STATUS.UP ? "OK" : "Dilaporkan down oleh target")).slice(0, 500);
  const ping = Number(q.ping ?? q.response_time);

  await applyResult(monitor, { status, message, ms: Number.isFinite(ping) && ping >= 0 ? Math.round(ping) : null });
  res.json({ ok: true });
}

pushRouter.get("/:token", handlePush);
pushRouter.post("/:token", handlePush);
