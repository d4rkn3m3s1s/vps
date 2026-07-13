-- Faz 3: device wake/sleep job types + device↔proxy persistent link + host live capacity.
-- All idempotent (the project applies migrations idempotently).

-- 1) New job types for real Waydroid start/stop (EMULATOR_START only ack'd them).
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'DEVICE_WAKE';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'DEVICE_SLEEP';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Device ↔ Proxy persistent assignment.
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "proxyId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Device"
    ADD CONSTRAINT "Device_proxyId_fkey"
    FOREIGN KEY ("proxyId") REFERENCES "Proxy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Device_proxyId_idx" ON "Device"("proxyId");

-- 3) Host live capacity metrics (disk/ram from agent heartbeat).
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "diskTotalGb" INTEGER;
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "diskFreeGb" INTEGER;
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "ramFreeGb" INTEGER;
