import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config } from "./config.js";

export const prisma = new PrismaClient();

export const ROLES = ["admin", "viewer"];

// Seed admin pertama kali (hanya jika tabel users kosong).
// Worker multi-location memakai seedAdmin:false — DB-nya sudah disiapkan instance web.
export async function initDb({ seedAdmin = true } = {}) {
  await prisma.$connect();
  if (!seedAdmin) return;
  const count = await prisma.user.count();
  if (count === 0) {
    await prisma.user.create({
      data: { username: config.adminUsername, password_hash: bcrypt.hashSync(config.adminPassword, 10), role: "admin" },
    });
    console.log(`[db] admin user dibuat: ${config.adminUsername}`);
  }
}

// Bersihkan heartbeat lama agar DB tidak membengkak (HEARTBEAT_RETENTION_DAYS)
export async function pruneOldHeartbeats() {
  const days = Math.max(1, config.heartbeatRetentionDays);
  const cutoff = new Date(Date.now() - days * 86400_000);
  const { count } = await prisma.heartbeat.deleteMany({ where: { created_at: { lt: cutoff } } });
  if (count) console.log(`[db] prune ${count} heartbeat lama`);
}
