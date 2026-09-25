-- Phase 8: riwayat pengiriman notifikasi, termasuk yang gagal.
-- Sebelum ini kegagalan kirim hanya muncul di stdout, sehingga saluran alert
-- bisa mati diam-diam tanpa terlihat dari mana pun di aplikasi.
CREATE TABLE "notification_logs" (
  "id"                SERIAL NOT NULL,
  "notification_id"   INTEGER,
  "notification_name" TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "event"             TEXT NOT NULL,
  "monitor_id"        INTEGER,
  "monitor_name"      TEXT,
  "ok"                BOOLEAN NOT NULL DEFAULT false,
  "attempts"          INTEGER NOT NULL DEFAULT 1,
  "error"             TEXT,
  "duration_ms"       INTEGER,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_logs_created_at_idx" ON "notification_logs"("created_at" DESC);
CREATE INDEX "notification_logs_notification_id_created_at_idx" ON "notification_logs"("notification_id", "created_at" DESC);
CREATE INDEX "notification_logs_ok_created_at_idx" ON "notification_logs"("ok", "created_at" DESC);
