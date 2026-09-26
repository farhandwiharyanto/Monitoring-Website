-- Penghitung rate limit bersama antar-instance (RATE_LIMIT_STORE=database)
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key","window_start")
);

CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits"("expires_at");
