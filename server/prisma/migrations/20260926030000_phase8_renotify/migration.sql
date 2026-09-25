-- Pengingat berkala selama monitor masih down. NULL = tidak mengingatkan,
-- perilakunya seperti sebelumnya: satu alert saat down, lalu senyap.
ALTER TABLE "monitors" ADD COLUMN "renotify_minutes" INTEGER;

-- Kapan kabar terakhir soal incident ini dikirim, dan sudah berapa kali
-- diingatkan. Dipakai penyapu untuk tahu siapa yang sudah jatuh tempo.
ALTER TABLE "incidents" ADD COLUMN "last_notified_at" TIMESTAMP(3);
ALTER TABLE "incidents" ADD COLUMN "renotify_count" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "incidents_resolved_at_last_notified_at_idx" ON "incidents"("resolved_at", "last_notified_at");
