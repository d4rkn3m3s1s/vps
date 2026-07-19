-- Telegram: on-device account-registration job type (mirrors REGISTER_WHATSAPP).
-- Phone-number signup with an OTP-park state machine; Telegram-specific parks are
-- other-device OTP (operator reads the in-app code) and a 2FA cloud-password prompt.
-- Idempotent — bare ADD VALUE (cannot run inside a PL/pgSQL block).
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'TELEGRAM_REGISTER';
