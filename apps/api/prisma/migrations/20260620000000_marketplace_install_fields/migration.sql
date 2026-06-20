-- FleetHub marketplace: make listings actually installable. apkUrl + packageName
-- let installListing() dispatch an EMULATOR_INSTALL_APK job per selected device,
-- instead of only bumping the installs counter.
ALTER TABLE "MarketplaceListing" ADD COLUMN IF NOT EXISTS "apkUrl" TEXT;
ALTER TABLE "MarketplaceListing" ADD COLUMN IF NOT EXISTS "packageName" TEXT;
