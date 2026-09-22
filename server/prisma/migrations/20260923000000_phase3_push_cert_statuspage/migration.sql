-- AlterTable
ALTER TABLE "monitors" ADD COLUMN     "cert_expires_at" TIMESTAMP(3),
ADD COLUMN     "cert_issuer" TEXT,
ADD COLUMN     "cert_notified_at" TIMESTAMP(3),
ADD COLUMN     "check_cert" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "push_grace_seconds" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "push_token" TEXT;

-- AlterTable
ALTER TABLE "status_pages" ADD COLUMN     "accent_color" TEXT NOT NULL DEFAULT '#38bdf8',
ADD COLUMN     "announcement" TEXT,
ADD COLUMN     "announcement_style" TEXT NOT NULL DEFAULT 'info',
ADD COLUMN     "custom_domain" TEXT,
ADD COLUMN     "footer_text" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "show_bars" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_incidents" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_uptime" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "theme" TEXT NOT NULL DEFAULT 'dark';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "monitors_push_token_key" ON "monitors"("push_token");

-- CreateIndex
CREATE UNIQUE INDEX "status_pages_custom_domain_key" ON "status_pages"("custom_domain");

