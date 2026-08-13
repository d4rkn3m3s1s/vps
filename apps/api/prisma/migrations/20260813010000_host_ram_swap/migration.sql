-- ★2026-08-13 RAM TAVANI ALARMI için iki alan.
--
-- Neden: 13 Ağu ölçümü (163 instance) → used 215/250 GB, available 40 GB, cihaz başına
-- 1.32 GB, swap 1.7 GB kullanımda. Gerçek tavan ~195 cihaz ve filo ona 30 cihaz
-- uzaktaydı, ama RAM için HİÇBİR alarm yoktu (yalnızca CPU + disk vardı). RAM biterse
-- Waydroid container'ları OOM ile ölür → cihazlar düşer, süren kayıtlar yarıda kesilir.
--
-- ramTotalGb : yüzde hesaplayabilmek için (ramFreeGb tek başına eşik veremiyordu)
-- swapUsedPct: RAM tükenmeden ÖNCEKİ erken uyarı (swap'a girmek ilk işaret)
--
-- Proje kuralı gereği idempotent (IF NOT EXISTS) — migration'lar tekrar uygulanabilir.
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "ramTotalGb" INTEGER;
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "swapUsedPct" INTEGER;
