-- Per-device, per-day online-minute rollup for usage metering / pay-as-you-go.
CREATE TABLE IF NOT EXISTS "DeviceUsage" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "onlineMinutes" INTEGER NOT NULL DEFAULT 0,
  "workspaceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeviceUsage_deviceId_day_key" ON "DeviceUsage"("deviceId", "day");
CREATE INDEX IF NOT EXISTS "DeviceUsage_workspaceId_day_idx" ON "DeviceUsage"("workspaceId", "day");

DO $$ BEGIN
  ALTER TABLE "DeviceUsage" ADD CONSTRAINT "DeviceUsage_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
