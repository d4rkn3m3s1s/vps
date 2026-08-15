-- WA_UPDATE_APK job tipi: WhatsApp'i filo-referans APK'ya guncelle (veri koruyarak).
-- Idempotent: enum degeri zaten varsa hata verme.
DO $$
BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WA_UPDATE_APK';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
