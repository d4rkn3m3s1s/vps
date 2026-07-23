-- DEVICE_DESTROY JobType: cihaz silinince host'taki Waydroid instance'ini tam yok et
-- (wd-destroy.sh). Idempotent — mevcut enum degeri ise no-op.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'DEVICE_DESTROY';
