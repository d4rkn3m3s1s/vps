-- Add outbound delivery-receipt webhook events (✓✓ delivered, blue-tick read) so
-- integrators can react when a sent message is delivered/read on the peer's phone,
-- not just when it left our device (WHATSAPP_SENT). Idempotent: each ADD VALUE is
-- guarded so re-running (the project applies migrations idempotently) is safe.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WHATSAPP_DELIVERED' AND enumtypid = 'public."WebhookEvent"'::regtype) THEN
    ALTER TYPE "WebhookEvent" ADD VALUE 'WHATSAPP_DELIVERED';
  END IF;
END$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'WHATSAPP_READ' AND enumtypid = 'public."WebhookEvent"'::regtype) THEN
    ALTER TYPE "WebhookEvent" ADD VALUE 'WHATSAPP_READ';
  END IF;
END$$;
