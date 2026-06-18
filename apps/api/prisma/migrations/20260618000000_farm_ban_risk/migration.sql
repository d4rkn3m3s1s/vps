-- Proactive ban-risk scoring for the farm.

-- AlterEnum: new alert trigger for ban-risk alerts.
ALTER TYPE "AlertTrigger" ADD VALUE IF NOT EXISTS 'FARM_BAN_RISK';

-- AlterTable: persist a per-account risk score + last-alerted timestamp so the
-- engine can fire once per cooldown instead of every tick.
ALTER TABLE "FarmAccount" ADD COLUMN IF NOT EXISTS "riskScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FarmAccount" ADD COLUMN IF NOT EXISTS "riskAlertedAt" TIMESTAMP(3);
