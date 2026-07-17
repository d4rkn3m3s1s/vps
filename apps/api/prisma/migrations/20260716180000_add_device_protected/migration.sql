-- Device.protected: refuse destructive ops (delete / reset / snapshot-restore /
-- data-wipe) on valuable phones (e.g. one holding an active WhatsApp account).
-- Idempotent: safe to re-apply.
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "protected" BOOLEAN NOT NULL DEFAULT false;
