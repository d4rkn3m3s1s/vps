-- ★2026-08-15 WA_SET_AUTODOWNLOAD JobType degeri (idempotent).
-- Gelen medyanin otomatik inmesi icin autodownload maskesini acan job.
-- Postgres: enum'a deger eklemek transaction-guvenli DEGIL, bu yuzden ayri;
-- zaten varsa (yeniden calisirsa) sessizce gecer.
DO $$
BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WA_SET_AUTODOWNLOAD';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
