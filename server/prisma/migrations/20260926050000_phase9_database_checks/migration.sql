-- Phase 9: monitor database (PostgreSQL, MySQL, Redis).
--
-- Dua kolom saja untuk seluruh tipe check baru, bukan satu kolom per opsi:
-- connection string disimpan terenkripsi seperti kredensial monitor lainnya,
-- sisanya (query, nama service, topik) masuk ke satu kolom JSON. Tipe check
-- berikutnya karena itu tidak perlu migration lagi.
ALTER TABLE "monitors" ADD COLUMN "conn_secret" TEXT;
ALTER TABLE "monitors" ADD COLUMN "check_config" JSONB;
