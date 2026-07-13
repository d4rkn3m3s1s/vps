-- Live WhatsApp-registration progress log on the account (Job.result gets
-- overwritten on completion, so progress can't live there). Idempotent.
ALTER TABLE "GeneratedAccount" ADD COLUMN IF NOT EXISTS "registerLog" JSONB;
