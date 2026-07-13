-- Host 1-minute load average from the agent heartbeat, for the "CPU yüksek —
-- boşta cihazları uyut?" dashboard warning. Idempotent (project applies migrations
-- idempotently). cpuCores already exists on Host; only loadAvg1m is new.
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "loadAvg1m" DOUBLE PRECISION;
