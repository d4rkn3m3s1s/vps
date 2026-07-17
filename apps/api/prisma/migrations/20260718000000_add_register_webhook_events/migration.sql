-- Add registration/provision lifecycle webhook events. Idempotent: each ADD VALUE is
-- guarded so re-running (the project applies migrations idempotently) is safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WHATSAPP_AWAITING_OTP' AND enumtypid = 'public."WebhookEvent"'::regtype) THEN
    ALTER TYPE "WebhookEvent" ADD VALUE 'WHATSAPP_AWAITING_OTP';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WHATSAPP_REGISTERED' AND enumtypid = 'public."WebhookEvent"'::regtype) THEN
    ALTER TYPE "WebhookEvent" ADD VALUE 'WHATSAPP_REGISTERED';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WHATSAPP_REGISTER_FAILED' AND enumtypid = 'public."WebhookEvent"'::regtype) THEN
    ALTER TYPE "WebhookEvent" ADD VALUE 'WHATSAPP_REGISTER_FAILED';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DEVICE_PROVISIONED' AND enumtypid = 'public."WebhookEvent"'::regtype) THEN
    ALTER TYPE "WebhookEvent" ADD VALUE 'DEVICE_PROVISIONED';
  END IF;
END$$;
