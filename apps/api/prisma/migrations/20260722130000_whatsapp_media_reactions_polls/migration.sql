-- More root-DB WhatsApp read job types (agent answers from msgstore.db/wa.db, no UI):
--   WHATSAPP_FETCH_MEDIA   — pull a downloaded media file off the device as base64
--   WHATSAPP_REACTIONS     — emoji reactions (message_add_on_reaction)
--   WHATSAPP_POLLS         — polls: question + options + vote counts (message_poll)
--   WHATSAPP_READ_BY       — per-recipient read receipts (who-read-in-group; receipt_user)
--   WHATSAPP_STARRED       — starred/bookmarked messages (message.starred)
--   WHATSAPP_LABELS        — WhatsApp Business labels (labels + labeled_jid)
--
-- Idempotent — bare ADD VALUE (cannot run inside a PL/pgSQL block).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_FETCH_MEDIA';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_REACTIONS';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_POLLS';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_READ_BY';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_STARRED';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_LABELS';
