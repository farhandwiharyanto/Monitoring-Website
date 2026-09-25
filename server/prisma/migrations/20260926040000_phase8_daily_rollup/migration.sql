-- Ringkasan harian per monitor, diisi tiap hari SEBELUM heartbeat lama dipangkas.
--
-- Heartbeat dibuang setelah HEARTBEAT_RETENTION_DAYS (bawaan 90 hari), jadi
-- grafik waktu respons yang lebih tua dari itu ikut hilang. Laporan SLA aman
-- karena dihitung dari tabel incident, bukan dari heartbeat — yang hilang hanya
-- riwayat kecepatan. Tabel ini menyimpan ringkasannya dengan biaya satu baris
-- per monitor per hari per lokasi.
CREATE TABLE "heartbeat_daily" (
  "monitor_id"  INTEGER NOT NULL,
  "day"         DATE NOT NULL,
  "location"    TEXT NOT NULL,
  "up"          INTEGER NOT NULL DEFAULT 0,
  "down"        INTEGER NOT NULL DEFAULT 0,
  "degraded"    INTEGER NOT NULL DEFAULT 0,
  "maintenance" INTEGER NOT NULL DEFAULT 0,
  "min_ms"      INTEGER,
  "avg_ms"      INTEGER,
  "p95_ms"      INTEGER,
  "max_ms"      INTEGER,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "heartbeat_daily_pkey" PRIMARY KEY ("monitor_id", "day", "location")
);

CREATE INDEX "heartbeat_daily_monitor_id_day_idx" ON "heartbeat_daily"("monitor_id", "day" DESC);
