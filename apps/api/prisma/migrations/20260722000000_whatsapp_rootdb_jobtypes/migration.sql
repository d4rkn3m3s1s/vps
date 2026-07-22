-- Root-DB WhatsApp read job types. The agent answers these straight from
-- WhatsApp's own SQLite (msgstore.db / wa.db) — no UI walk, zero ban surface.
--
-- The first six (CONVERSATIONS/RECEIPTS/MEDIA/CALLS/SEARCH/UNREAD) were added to
-- schema.prisma + the agent in a prior change but never got a migration file, so
-- a fresh DB would reject those enum values at runtime ("invalid input value for
-- enum JobType"). The last four (CONTACTS/GROUP_MEMBERS/CHAT_SUMMARY/
-- ACCOUNT_HEALTH) are new here. All ten are declared idempotently so this is safe
-- to re-apply on a DB that already has some of them.
--
-- Idempotent — bare ADD VALUE (cannot run inside a PL/pgSQL block).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_CONVERSATIONS';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_RECEIPTS';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_MEDIA';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_CALLS';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_SEARCH';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_UNREAD';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_CONTACTS';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_GROUP_MEMBERS';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_CHAT_SUMMARY';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_ACCOUNT_HEALTH';
