-- Phase 5: dependency antar-monitor & audit log

-- Dependency: monitor induk. Induk dihapus -> anaknya jadi mandiri (SET NULL),
-- bukan ikut terhapus, supaya data historisnya tidak hilang.
ALTER TABLE "monitors" ADD COLUMN "parent_id" INTEGER;
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "monitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "monitors_parent_id_idx" ON "monitors"("parent_id");

-- Penanda alert yang ditahan karena induk sedang down
ALTER TABLE "incidents" ADD COLUMN "suppressed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "incidents" ADD COLUMN "suppressed_by_id" INTEGER;

-- Audit log
CREATE TABLE "audit_logs" (
  "id"          SERIAL       NOT NULL,
  "actor_id"    INTEGER,
  "actor"       TEXT         NOT NULL,
  "actor_type"  TEXT         NOT NULL DEFAULT 'user',
  "action"      TEXT         NOT NULL,
  "entity"      TEXT         NOT NULL,
  "entity_id"   INTEGER,
  "entity_name" TEXT,
  "summary"     TEXT,
  "changes"     JSONB,
  "ip"          TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
CREATE INDEX "audit_logs_entity_entity_id_created_at_idx" ON "audit_logs"("entity", "entity_id", "created_at" DESC);
CREATE INDEX "audit_logs_actor_created_at_idx" ON "audit_logs"("actor", "created_at" DESC);
