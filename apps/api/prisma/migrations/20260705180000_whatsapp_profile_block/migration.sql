-- WhatsApp contact profile (avatar + name/about) and block/unblock support.
-- Idempotent — safe to re-apply.

-- 1) New job types. Bare ADD VALUE — cannot run inside a PL/pgSQL block.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_PROFILE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_BLOCK';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_BLOCKLIST';

-- 2) Conversation: blocked flag + cropped avatar data-URI + scraped profile text.
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "blocked"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "avatarBase64" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "avatarAt"     TIMESTAMP(3);
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "profileInfo"  JSONB;
