-- WhatsApp: own-number, media send, message delete, and clear-chat job types.
-- Idempotent — bare ADD VALUE (cannot run inside a PL/pgSQL block).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_MYNUMBER';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_SEND_MEDIA';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_DELETE_MSG';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_CLEAR_CHAT';
