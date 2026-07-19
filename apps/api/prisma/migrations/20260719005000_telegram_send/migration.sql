-- Telegram: on-device message-send job type (mirrors WHATSAPP_SEND).
-- Idempotent — bare ADD VALUE (cannot run inside a PL/pgSQL block).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'TELEGRAM_SEND';
