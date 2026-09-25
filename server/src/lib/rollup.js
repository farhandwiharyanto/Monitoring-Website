import { prisma } from "../db.js";
import { config } from "../config.js";

// Ringkasan harian heartbeat.
//
// Dijalankan tiap hari sebelum pemangkasan, supaya hari-hari yang barisnya akan
// dibuang sudah punya ringkasannya. Seluruh pekerjaan dilakukan di dalam satu
// pernyataan SQL: menarik jutaan heartbeat ke Node hanya untuk dijumlahkan di
// sana akan jauh lebih mahal daripada membiarkan Postgres mengerjakannya.
//
// p95 memakai percentile_cont, bukan rata-rata: layanan dengan rata-rata 200 ms
// tapi p95 3 detik terasa lambat bagi sebagian pengguna, dan rata-rata sendiri
// tidak pernah memperlihatkannya.

// Hari yang diringkas: `days` hari terakhir, termasuk hari ini.
//
// Hari yang sudah pernah diringkas sengaja dihitung ulang, bukan dilewati —
// hari ini masih bertambah heartbeat-nya, dan worker lokasi lain bisa terlambat
// menulis. ON CONFLICT membuat perhitungan ulang itu aman diulang berapa kali pun.
export async function rollupDaily({ days = 3 } = {}) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400_000);
  const affected = await prisma.$executeRaw`
    INSERT INTO heartbeat_daily
      ("monitor_id", "day", "location", "up", "down", "degraded", "maintenance",
       "min_ms", "avg_ms", "p95_ms", "max_ms", "updated_at")
    SELECT
      monitor_id,
      (created_at)::date                                    AS day,
      COALESCE(location, ${config.primaryLocation})         AS location,
      COUNT(*) FILTER (WHERE status = 1)::int               AS up,
      COUNT(*) FILTER (WHERE status = 0)::int               AS down,
      COUNT(*) FILTER (WHERE degraded)::int                 AS degraded,
      COUNT(*) FILTER (WHERE maintenance)::int              AS maintenance,
      MIN(response_time) FILTER (WHERE status = 1)::int     AS min_ms,
      ROUND(AVG(response_time) FILTER (WHERE status = 1))::int AS avg_ms,
      ROUND(percentile_cont(0.95) WITHIN GROUP (
        ORDER BY response_time) FILTER (WHERE status = 1 AND response_time IS NOT NULL))::int AS p95_ms,
      MAX(response_time) FILTER (WHERE status = 1)::int     AS max_ms,
      NOW() AT TIME ZONE 'UTC'
    FROM heartbeats
    WHERE created_at >= ${since}
    -- Dikelompokkan lewat posisi kolom, bukan dengan menulis ulang ekspresinya:
    -- setiap ${"$"}{} pada kueri Prisma jadi placeholder tersendiri, sehingga
    -- COALESCE yang ditulis dua kali tidak dianggap ekspresi yang sama oleh
    -- Postgres dan GROUP BY-nya ditolak.
    GROUP BY 1, 2, 3
    ON CONFLICT ("monitor_id", "day", "location") DO UPDATE SET
      "up" = EXCLUDED."up", "down" = EXCLUDED."down", "degraded" = EXCLUDED."degraded",
      "maintenance" = EXCLUDED."maintenance", "min_ms" = EXCLUDED."min_ms",
      "avg_ms" = EXCLUDED."avg_ms", "p95_ms" = EXCLUDED."p95_ms",
      "max_ms" = EXCLUDED."max_ms", "updated_at" = EXCLUDED."updated_at"`;
  if (affected) console.log(`[rollup] ${affected} baris ringkasan harian diperbarui`);
  return affected;
}

// Mengisi seluruh riwayat yang masih ada heartbeat-nya. Dipanggil sekali saat
// start supaya instance yang baru dimutakhirkan tidak menunggu sampai besok
// pagi untuk punya grafik.
export async function backfillDaily() {
  const [row] = await prisma.$queryRaw`SELECT MIN(created_at) AS oldest FROM heartbeats`;
  if (!row?.oldest) return 0;
  const days = Math.ceil((Date.now() - new Date(row.oldest).getTime()) / 86400_000) + 1;
  return rollupDaily({ days });
}

// Ringkasan harian satu monitor untuk grafik. Lokasi primary saja, supaya
// angkanya sejalan dengan uptime dan status di dashboard.
export async function dailySeries(monitorId, { days = 90 } = {}) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400_000);
  const rows = await prisma.$queryRaw`
    SELECT "day", "up", "down", "degraded", "maintenance", "min_ms", "avg_ms", "p95_ms", "max_ms"
    FROM heartbeat_daily
    WHERE "monitor_id" = ${Number(monitorId)}
      AND "location" = ${config.primaryLocation}
      AND "day" >= ${since}
    ORDER BY "day" ASC`;
  return rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
    up: r.up,
    down: r.down,
    degraded: r.degraded,
    maintenance: r.maintenance,
    // Heartbeat maintenance tidak dikecualikan di sini, sama seperti grafik
    // waktu respons lainnya; yang dikecualikan hanyalah perhitungan uptime.
    uptime: r.up + r.down ? Math.round((r.up / (r.up + r.down)) * 10000) / 100 : null,
    min_ms: r.min_ms,
    avg_ms: r.avg_ms,
    p95_ms: r.p95_ms,
    max_ms: r.max_ms,
  }));
}
