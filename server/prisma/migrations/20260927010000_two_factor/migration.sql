-- 2FA (TOTP) per user
ALTER TABLE "users" ADD COLUMN "totp_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "totp_recovery" JSONB;
ALTER TABLE "users" ADD COLUMN "totp_last_step" INTEGER;
