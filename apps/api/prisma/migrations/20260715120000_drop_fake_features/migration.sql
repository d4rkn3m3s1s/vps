-- Drop the "fake feature" data models whose API modules + dashboard pages were
-- removed: referral program, trend metric snapshots, usage metering, asset
-- library, automation-template marketplace, and the FleetHub listing market.
-- Idempotent: every statement guards with IF EXISTS so it is safe to re-apply.

-- Referral column on User (drop before the table it referenced).
ALTER TABLE "User" DROP COLUMN IF EXISTS "referralCode";

-- Tables. CASCADE removes any dependent indexes / FK constraints.
DROP TABLE IF EXISTS "Referral" CASCADE;
DROP TABLE IF EXISTS "MetricSnapshot" CASCADE;
DROP TABLE IF EXISTS "DeviceUsage" CASCADE;
DROP TABLE IF EXISTS "LibraryAsset" CASCADE;
DROP TABLE IF EXISTS "AutomationTemplate" CASCADE;
DROP TABLE IF EXISTS "MarketplaceListing" CASCADE;

-- Enums that only these tables used.
DROP TYPE IF EXISTS "ReferralStatus";
DROP TYPE IF EXISTS "LibraryAssetType";
DROP TYPE IF EXISTS "ListingCategory";
