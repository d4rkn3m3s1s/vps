-- Remove external cloud-phone vendor integration (GeeLark/VMOS/DuoPlus/UGPhone).
-- We run our own Waydroid fleet, so the provider adapters + linkage are dropped.
-- Idempotent. `externalId` is intentionally KEPT.

-- Device → external cloud-phone linkage columns.
ALTER TABLE "Device" DROP COLUMN IF EXISTS "cloudProvider";
ALTER TABLE "Device" DROP COLUMN IF EXISTS "cloudProviderId";

-- Configured external vendor accounts.
DROP TABLE IF EXISTS "CloudPhoneProvider" CASCADE;

-- Provider-kind enum.
DROP TYPE IF EXISTS "CloudProviderKind";
