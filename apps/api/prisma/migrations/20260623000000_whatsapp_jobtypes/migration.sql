-- Add WhatsApp job types to the JobType enum (idempotent).
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'REGISTER_WHATSAPP';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_SEND';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'WHATSAPP_READ';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
