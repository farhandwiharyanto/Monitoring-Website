-- AlterTable
ALTER TABLE "heartbeats" ADD COLUMN     "assertion_message" TEXT,
ADD COLUMN     "assertion_ok" BOOLEAN,
ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "monitors" DROP COLUMN "cert_notified_at",
ADD COLUMN     "assertion_operator" TEXT,
ADD COLUMN     "assertion_path" TEXT,
ADD COLUMN     "assertion_value" TEXT,
ADD COLUMN     "auth_secret" TEXT,
ADD COLUMN     "auth_type" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "cert_chain_error" TEXT,
ADD COLUMN     "cert_chain_valid" BOOLEAN,
ADD COLUMN     "cert_checked_at" TIMESTAMP(3),
ADD COLUMN     "cert_notified_threshold" INTEGER,
ADD COLUMN     "cert_subject" TEXT,
ADD COLUMN     "http_headers" JSONB;

-- CreateIndex
CREATE INDEX "heartbeats_monitor_id_location_created_at_idx" ON "heartbeats"("monitor_id", "location", "created_at" DESC);

