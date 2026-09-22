-- AlterTable
ALTER TABLE "monitors" ADD COLUMN     "action_on_down" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "action_on_recover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "action_webhook_headers" JSONB,
ADD COLUMN     "action_webhook_method" TEXT NOT NULL DEFAULT 'POST',
ADD COLUMN     "action_webhook_url" TEXT;

-- CreateTable
CREATE TABLE "incident_updates" (
    "id" SERIAL NOT NULL,
    "incident_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "message" TEXT NOT NULL,
    "author" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_events" (
    "id" SERIAL NOT NULL,
    "monitor_id" INTEGER NOT NULL,
    "incident_id" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'automation',
    "source" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" SERIAL NOT NULL,
    "monitor_id" INTEGER NOT NULL,
    "incident_id" INTEGER,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "status_code" INTEGER,
    "error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'read',
    "created_by" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_tags" (
    "status_page_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "status_page_tags_pkey" PRIMARY KEY ("status_page_id","tag_id")
);

-- CreateIndex
CREATE INDEX "incident_updates_incident_id_created_at_idx" ON "incident_updates"("incident_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "monitor_events_monitor_id_created_at_idx" ON "monitor_events"("monitor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_logs_monitor_id_created_at_idx" ON "webhook_logs"("monitor_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_revoked_at_idx" ON "api_keys"("revoked_at");

-- AddForeignKey
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_events" ADD CONSTRAINT "monitor_events_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_events" ADD CONSTRAINT "monitor_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_tags" ADD CONSTRAINT "status_page_tags_status_page_id_fkey" FOREIGN KEY ("status_page_id") REFERENCES "status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_tags" ADD CONSTRAINT "status_page_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

