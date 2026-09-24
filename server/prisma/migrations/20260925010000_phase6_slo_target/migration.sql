-- Phase 6: target SLO per monitor (persen, mis. 99.9). NULL = tanpa target.
ALTER TABLE "monitors" ADD COLUMN "slo_target" DOUBLE PRECISION;
