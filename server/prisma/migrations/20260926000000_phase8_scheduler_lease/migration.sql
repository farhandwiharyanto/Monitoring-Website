-- Phase 8: lease kepemimpinan scheduler, satu baris per lokasi.
-- Hanya proses pemegang lease yang menjalankan check, sehingga dua proses
-- dengan LOCATION_NAME sama (replika, atau rolling deploy yang tumpang tindih)
-- tidak melakukan check dan mengirim alert dua kali.
CREATE TABLE "scheduler_leases" (
  "location"   TEXT NOT NULL,
  "holder"     TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("location")
);
