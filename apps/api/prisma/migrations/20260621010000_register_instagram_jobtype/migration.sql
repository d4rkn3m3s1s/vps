-- Add REGISTER_INSTAGRAM to the JobType enum (idempotent).
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'REGISTER_INSTAGRAM';
EXCEPTION WHEN duplicate_object THEN null;
END $$;
