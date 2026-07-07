-- PROVISION_DEVICE: tek-tık cihaz kurulumu (boot→WhatsApp-hazır) için tek job
-- tipi. Agent akışı sırayla yürütür ve ilerlemeyi /agent/jobs/:id/progress ile
-- bildirir. Bare ADD VALUE — PL/pgSQL bloğunda çalıştırılamaz.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'PROVISION_DEVICE';
