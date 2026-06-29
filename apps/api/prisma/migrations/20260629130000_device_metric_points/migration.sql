-- Per-device resource timeseries (CPU/mem/disk %) for the device health charts.
CREATE TABLE IF NOT EXISTS "DeviceMetricPoint" (
  "id"          TEXT NOT NULL,
  "deviceId"    TEXT NOT NULL,
  "cpuUsage"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "memoryUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "diskUsage"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "capturedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceMetricPoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeviceMetricPoint_deviceId_capturedAt_idx"
  ON "DeviceMetricPoint" ("deviceId", "capturedAt");

DO $$ BEGIN
  ALTER TABLE "DeviceMetricPoint"
    ADD CONSTRAINT "DeviceMetricPoint_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
