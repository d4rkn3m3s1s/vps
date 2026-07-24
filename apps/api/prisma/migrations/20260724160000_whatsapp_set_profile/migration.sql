-- WHATSAPP_SET_NAME + WHATSAPP_SET_AVATAR JobType: kendi WA profilinin isim/resmini
-- değiştir (koordinat-tabanlı agent akışı + SetAsProfilePhoto intent). Idempotent.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_SET_NAME';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_SET_AVATAR';
