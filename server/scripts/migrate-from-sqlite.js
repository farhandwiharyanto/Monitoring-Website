#!/usr/bin/env node
/**
 * Migrasi data Pulsewatch v1 (SQLite) → v2 (PostgreSQL via Prisma).
 *
 *   DATABASE_URL=postgresql://... node scripts/migrate-from-sqlite.js /path/ke/pulsewatch.db [--wipe]
 *
 * - ID asli dipertahankan supaya relasi & link (mis. /monitors/3) tetap sama.
 * - Aman dijalankan ke DB Postgres kosong. Jika sudah ada data, pakai --wipe untuk
 *   mengosongkan dulu, atau script akan berhenti.
 * - Butuh paket better-sqlite3 (devDependency): `npm install` di folder server.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const file = process.argv[2] || process.env.SQLITE_PATH || "./data/pulsewatch.db";
const wipe = process.argv.includes("--wipe");

if (!fs.existsSync(file)) {
  console.error(`File SQLite tidak ditemukan: ${path.resolve(file)}`);
  process.exit(1);
}
let Database;
try {
  ({ default: Database } = await import("better-sqlite3"));
} catch {
  console.error("Paket better-sqlite3 belum terpasang. Jalankan: npm install better-sqlite3");
  process.exit(1);
}

const sqlite = new Database(file, { readonly: true });
const prisma = new PrismaClient();

// SQLite menyimpan "YYYY-MM-DD HH:MM:SS" dalam UTC tanpa zona
const toDate = (s) => (s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z") : null);
const bool = (v) => v === 1 || v === true;
const all = (sql) => {
  try { return sqlite.prepare(sql).all(); } catch { return []; }
};

const TABLES = ["users", "monitors", "heartbeats", "incidents", "notifications", "monitor_notifications", "status_pages", "status_page_monitors", "tags", "monitor_tags", "maintenance_windows"];

async function main() {
  const existing = await prisma.monitor.count() + await prisma.user.count();
  if (existing > 0) {
    if (!wipe) {
      console.error("Database Postgres sudah berisi data. Tambahkan --wipe untuk mengosongkan dulu.");
      process.exit(1);
    }
    console.log("[wipe] mengosongkan tabel tujuan…");
    await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }

  const users = all("SELECT * FROM users");
  const monitors = all("SELECT * FROM monitors");
  const heartbeats = all("SELECT * FROM heartbeats ORDER BY id");
  const incidents = all("SELECT * FROM incidents");
  const notifications = all("SELECT * FROM notifications");
  const monNotif = all("SELECT * FROM monitor_notifications");
  const pages = all("SELECT * FROM status_pages");
  const pageMon = all("SELECT * FROM status_page_monitors");

  console.log(`[read] users=${users.length} monitors=${monitors.length} heartbeats=${heartbeats.length} incidents=${incidents.length} notifications=${notifications.length} status_pages=${pages.length}`);

  await prisma.$transaction(async (tx) => {
    await tx.user.createMany({
      data: users.map((u) => ({ id: u.id, username: u.username, password_hash: u.password_hash, role: u.role || "admin", created_at: toDate(u.created_at) })),
    });
    await tx.monitor.createMany({
      data: monitors.map((m) => ({
        id: m.id, name: m.name, type: m.type, url: m.url, hostname: m.hostname, port: m.port,
        dns_resolve_type: m.dns_resolve_type || "A", dns_expected: m.dns_expected, method: m.method || "GET",
        interval_seconds: m.interval_seconds, timeout_seconds: m.timeout_seconds, max_retries: m.max_retries,
        expected_status_codes: m.expected_status_codes || "200-299", keyword: m.keyword, active: bool(m.active),
        created_at: toDate(m.created_at), updated_at: toDate(m.updated_at) || toDate(m.created_at),
      })),
    });
    await tx.notification.createMany({
      data: notifications.map((n) => ({
        id: n.id, name: n.name, type: n.type, is_default: bool(n.is_default), created_at: toDate(n.created_at),
        config: (() => { try { return JSON.parse(n.config || "{}"); } catch { return {}; } })(),
      })),
    });
    await tx.monitorNotification.createMany({ data: monNotif.map((r) => ({ monitor_id: r.monitor_id, notification_id: r.notification_id })), skipDuplicates: true });
    await tx.statusPage.createMany({
      data: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, description: p.description, published: bool(p.published), created_at: toDate(p.created_at) })),
    });
    await tx.statusPageMonitor.createMany({ data: pageMon.map((r) => ({ status_page_id: r.status_page_id, monitor_id: r.monitor_id, sort_order: r.sort_order || 0 })), skipDuplicates: true });
    await tx.incident.createMany({
      data: incidents.map((i) => ({
        id: i.id, monitor_id: i.monitor_id, started_at: toDate(i.started_at), resolved_at: toDate(i.resolved_at), cause: i.cause,
        maintenance: false, notified: true, // v1 selalu mengirim alert
      })),
    });
    // Heartbeat bisa sangat banyak → batch
    for (let i = 0; i < heartbeats.length; i += 5000) {
      await tx.heartbeat.createMany({
        data: heartbeats.slice(i, i + 5000).map((h) => ({
          id: h.id, monitor_id: h.monitor_id, status: h.status, message: h.message, response_time: h.response_time,
          important: bool(h.important), maintenance: false, created_at: toDate(h.created_at),
        })),
      });
      process.stdout.write(`\r[heartbeats] ${Math.min(i + 5000, heartbeats.length)}/${heartbeats.length}`);
    }
    if (heartbeats.length) process.stdout.write("\n");

    // Sinkronkan sequence karena ID di-insert eksplisit
    for (const t of ["users", "monitors", "heartbeats", "incidents", "notifications", "status_pages"]) {
      await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 0) + 1, false)`);
    }
  }, { timeout: 10 * 60_000 });

  console.log("[done] migrasi selesai.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { sqlite.close(); await prisma.$disconnect(); });
