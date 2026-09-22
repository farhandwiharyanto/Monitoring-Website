import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { config } from "./config.js";

export const prisma = new PrismaClient();

export const ROLES = ["admin", "viewer"];

// Seed admin pertama kali (hanya jika tabel users kosong)
export async function initDb() {
  await prisma.$connect();
  const count = await prisma.user.count();
  if (count === 0) {
    await prisma.user.create({
      data: { username: config.adminUsername, password_hash: bcrypt.hashSync(config.adminPassword, 10), role: "admin" },
    });
    console.log(`[db] admin user dibuat: ${config.adminUsername}`);
  }
}

// Bersihkan heartbeat > 90 hari agar DB tidak membengkak
export async function pruneOldHeartbeats() {
  const cutoff = new Date(Date.now() - 90 * 86400_000);
  const { count } = await prisma.heartbeat.deleteMany({ where: { created_at: { lt: cutoff } } });
  if (count) console.log(`[db] prune ${count} heartbeat lama`);
}
