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

// Metrik monitor database ikut dibersihkan (DB_METRICS_RETENTION_DAYS)
export async function pruneOldDbMetrics() {
  const days = Math.max(1, config.dbMetricsRetentionDays);
  const cutoff = new Date(Date.now() - days * 86400_000);
  const { count } = await prisma.dbMetric.deleteMany({ where: { created_at: { lt: cutoff } } });
  if (count) console.log(`[db] prune ${count} metrik database lama`);
}

// Audit log ikut dibersihkan agar tabelnya tidak tumbuh selamanya (AUDIT_RETENTION_DAYS)
export async function pruneOldAuditLogs() {
  const days = Math.max(1, config.auditRetentionDays);
  const cutoff = new Date(Date.now() - days * 86400_000);
  const { count } = await prisma.auditLog.deleteMany({ where: { created_at: { lt: cutoff } } });
  if (count) console.log(`[db] prune ${count} audit log lama`);
}

// Riwayat pengiriman notifikasi ikut dibersihkan (NOTIFICATION_LOG_RETENTION_DAYS)
export async function pruneOldNotificationLogs() {
  const days = Math.max(1, config.notificationLogRetentionDays);
  const cutoff = new Date(Date.now() - days * 86400_000);
  const { count } = await prisma.notificationLog.deleteMany({ where: { created_at: { lt: cutoff } } });
  if (count) console.log(`[db] prune ${count} log notifikasi lama`);
}

// Ping database untuk endpoint /api/health. Dipakai orchestrator (healthcheck
// Docker, probe Kubernetes) untuk membedakan "proses hidup" dari "aplikasi
// benar-benar bisa bekerja" — tanpa ini, instance yang kehilangan database
// tetap dilaporkan sehat dan tidak pernah di-restart.
// Diberi batas waktu sendiri karena kueri Prisma tidak punya: database yang
// menggantung (bukan menolak) akan membuat permintaan health ikut menggantung,
// padahal justru saat itulah jawabannya paling dibutuhkan.
export async function pingDb({ timeoutMs = 3000 } = {}) {
  const start = performance.now();
  let timer;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Database tidak menjawab dalam ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, latency_ms: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
