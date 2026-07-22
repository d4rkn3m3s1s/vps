-- Root-only WhatsApp capture job types + media-capture webhook event.
--   WHATSAPP_VIEW_ONCE    — pull view-once media as base64 (even after opened)
--   WHATSAPP_VOICE_NOTES  — voice notes (PTT audio), optionally base64
--   WHATSAPP_DELETED      — "delete for everyone" messages surviving in the DB (anti-delete)
--   WHATSAPP_LINKS        — every URL shared in the account's chats
-- And the WHATSAPP_MEDIA_CAPTURED webhook event fired by the media auto-capture poll.
--
-- Idempotent — bare ADD VALUE (cannot run inside a PL/pgSQL block).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_VIEW_ONCE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_VOICE_NOTES';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_DELETED';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_LINKS';
ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'WHATSAPP_MEDIA_CAPTURED';
