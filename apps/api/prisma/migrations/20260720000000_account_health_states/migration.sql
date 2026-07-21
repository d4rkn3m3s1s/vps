-- Add WhatsApp account-health states to GeneratedAccountStatus.
-- RESTRICTED / BANNED / LOGGED_OUT let an ACTIVE account transition to a health
-- state detected on-device (send result or inbound system notice), surfaced on the
-- profile card and via the WHATSAPP_ACCOUNT_HEALTH webhook.
-- Postgres requires each ADD VALUE in its own statement; guard each idempotently.

DO $$
BEGIN
  ALTER TYPE "GeneratedAccountStatus" ADD VALUE IF NOT EXISTS 'RESTRICTED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "GeneratedAccountStatus" ADD VALUE IF NOT EXISTS 'BANNED';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TYPE "GeneratedAccountStatus" ADD VALUE IF NOT EXISTS 'LOGGED_OUT';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Webhook event for account-health transitions.
DO $$
BEGIN
  ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'WHATSAPP_ACCOUNT_HEALTH';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
