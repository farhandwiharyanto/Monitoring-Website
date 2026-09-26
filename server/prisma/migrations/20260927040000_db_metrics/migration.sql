-- Metrik monitor database untuk menu Database
CREATE TABLE "db_metrics" (
    "id" SERIAL NOT NULL,
    "monitor_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "db_metrics_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "db_metrics_monitor_id_created_at_idx" ON "db_metrics"("monitor_id", "created_at" DESC);

ALTER TABLE "db_metrics" ADD CONSTRAINT "db_metrics_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
