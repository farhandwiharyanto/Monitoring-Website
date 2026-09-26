-- Rantai eskalasi bisa diulang setelah tingkat terakhir
ALTER TABLE "escalation_policies" ADD COLUMN "repeat_times" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "escalation_policies" ADD COLUMN "repeat_minutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "escalations" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "escalation_deliveries" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
