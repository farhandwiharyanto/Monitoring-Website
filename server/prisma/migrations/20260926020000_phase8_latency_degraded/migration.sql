-- Ambang latency per monitor. NULL = monitor ini tidak dinilai kecepatannya,
-- perilakunya persis seperti sebelumnya.
ALTER TABLE "monitors" ADD COLUMN "latency_threshold_ms" INTEGER;

-- Degraded sengaja jadi kolom tersendiri, bukan nilai status baru: heartbeat-nya
-- tetap UP (status = 1) sehingga seluruh perhitungan uptime, laporan SLA, dan
-- riwayat lama tidak berubah artinya. Yang bertambah hanya penanda "up, tapi
-- lebih lambat dari yang dijanjikan".
ALTER TABLE "heartbeats" ADD COLUMN "degraded" BOOLEAN NOT NULL DEFAULT false;
