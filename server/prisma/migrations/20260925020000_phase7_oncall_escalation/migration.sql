-- Phase 7: jadwal on-call, escalation policy berjenjang, dan acknowledge.

-- Kontak pribadi untuk paging on-call. Notifikasi dihapus -> user kehilangan
-- kontaknya (SET NULL), bukan ikut terhapus.
ALTER TABLE "users" ADD COLUMN "oncall_notification_id" INTEGER;

-- Escalation policy yang dipakai monitor. NULL = pakai policy default.
ALTER TABLE "monitors" ADD COLUMN "escalation_policy_id" INTEGER;

-- Jadwal rotasi
CREATE TABLE "oncall_schedules" (
  "id"          SERIAL       NOT NULL,
  "name"        TEXT         NOT NULL,
  "description" TEXT,
  "timezone"    TEXT         NOT NULL DEFAULT 'Asia/Jakarta',
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oncall_schedules_pkey" PRIMARY KEY ("id")
);

-- Shift bebas per rentang waktu. Boleh bertumpang tindih; yang menang adalah
-- shift dengan start_at terakhir yang mencakup saat itu.
CREATE TABLE "oncall_shifts" (
  "id"          SERIAL       NOT NULL,
  "schedule_id" INTEGER      NOT NULL,
  "user_id"     INTEGER      NOT NULL,
  "start_at"    TIMESTAMP(3) NOT NULL,
  "end_at"      TIMESTAMP(3) NOT NULL,
  "note"        TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "oncall_shifts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "oncall_shifts_schedule_id_start_at_idx" ON "oncall_shifts"("schedule_id", "start_at");
CREATE INDEX "oncall_shifts_schedule_id_end_at_idx" ON "oncall_shifts"("schedule_id", "end_at");

CREATE TABLE "escalation_policies" (
  "id"          SERIAL       NOT NULL,
  "name"        TEXT         NOT NULL,
  "description" TEXT,
  "is_default"  BOOLEAN      NOT NULL DEFAULT false,
  "active"      BOOLEAN      NOT NULL DEFAULT true,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("id")
);

-- Tiap tingkat menunjuk notifikasi yang sudah ada: lewat jadwal on-call
-- (kontak pribadi yang bertugas) atau satu channel langsung.
CREATE TABLE "escalation_steps" (
  "id"              SERIAL  NOT NULL,
  "policy_id"       INTEGER NOT NULL,
  "step_order"      INTEGER NOT NULL DEFAULT 0,
  "delay_minutes"   INTEGER NOT NULL DEFAULT 0,
  "target"          TEXT    NOT NULL DEFAULT 'oncall',
  "schedule_id"     INTEGER,
  "notification_id" INTEGER,

  CONSTRAINT "escalation_steps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "escalation_steps_policy_id_step_order_idx" ON "escalation_steps"("policy_id", "step_order");

-- Satu rantai eskalasi per incident
CREATE TABLE "escalations" (
  "id"              SERIAL       NOT NULL,
  "incident_id"     INTEGER      NOT NULL,
  "monitor_id"      INTEGER      NOT NULL,
  "policy_id"       INTEGER,
  "started_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ack_token"       TEXT         NOT NULL,
  "acknowledged_at" TIMESTAMP(3),
  "acknowledged_by" TEXT,
  "stopped_at"      TIMESTAMP(3),
  "stopped_reason"  TEXT,

  CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "escalations_incident_id_key" ON "escalations"("incident_id");
CREATE UNIQUE INDEX "escalations_ack_token_key" ON "escalations"("ack_token");
CREATE INDEX "escalations_stopped_at_idx" ON "escalations"("stopped_at");

-- Rencana pengiriman per tingkat, dibuat sekaligus saat rantai mulai
CREATE TABLE "escalation_deliveries" (
  "id"              SERIAL       NOT NULL,
  "escalation_id"   INTEGER      NOT NULL,
  "step_order"      INTEGER      NOT NULL,
  "delay_minutes"   INTEGER      NOT NULL,
  "due_at"          TIMESTAMP(3) NOT NULL,
  "status"          TEXT         NOT NULL DEFAULT 'pending',
  "sent_at"         TIMESTAMP(3),
  -- Sasaran disalin dari langkah policy saat rantai dibuat. Sengaja tanpa
  -- foreign key: jadwal/notifikasi yang dihapus tidak boleh menghapus riwayat.
  "target"          TEXT         NOT NULL DEFAULT 'oncall',
  "schedule_id"     INTEGER,
  "notification_id" INTEGER,
  "target_label"    TEXT,
  "error"           TEXT,

  CONSTRAINT "escalation_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "escalation_deliveries_status_due_at_idx" ON "escalation_deliveries"("status", "due_at");
CREATE INDEX "escalation_deliveries_escalation_id_step_order_idx" ON "escalation_deliveries"("escalation_id", "step_order");

ALTER TABLE "users" ADD CONSTRAINT "users_oncall_notification_id_fkey"
  FOREIGN KEY ("oncall_notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "monitors" ADD CONSTRAINT "monitors_escalation_policy_id_fkey"
  FOREIGN KEY ("escalation_policy_id") REFERENCES "escalation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "monitors_escalation_policy_id_idx" ON "monitors"("escalation_policy_id");

ALTER TABLE "oncall_shifts" ADD CONSTRAINT "oncall_shifts_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "oncall_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oncall_shifts" ADD CONSTRAINT "oncall_shifts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "escalation_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "oncall_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "escalations" ADD CONSTRAINT "escalations_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_monitor_id_fkey"
  FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "escalation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "escalation_deliveries" ADD CONSTRAINT "escalation_deliveries_escalation_id_fkey"
  FOREIGN KEY ("escalation_id") REFERENCES "escalations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
