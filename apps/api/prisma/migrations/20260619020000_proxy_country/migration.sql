-- Geo-matching: optional ISO country code per proxy.
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "countryCode" TEXT;
