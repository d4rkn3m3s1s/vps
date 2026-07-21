-- Broadcast multi-device fan-out + persist/resume support.
-- deviceIds: shard recipients across several phones (parallel send).
-- dispatchedCount: how many recipient jobs were dispatched (resume after restart).
-- status index: startup/reaper can find RUNNING broadcasts to resume.

ALTER TABLE "WhatsappBroadcast" ADD COLUMN IF NOT EXISTS "deviceIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "WhatsappBroadcast" ADD COLUMN IF NOT EXISTS "dispatchedCount" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  CREATE INDEX "WhatsappBroadcast_status_idx" ON "WhatsappBroadcast"("status");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
