-- ★2026-08-05 GERÇEK CPU MEŞGULİYETİ
-- `loadAvg1m` bu filoda CPU'yu DEĞİL uyuyan thread sayısını yansıtıyor (92 cihaz
-- ≈ 105.000 thread). Ölçüldü: load 90 iken CPU %96.5 BOŞTAYDI — doygunluk alarmı
-- bir gecede 13 yanlış bildirim gönderdi. Agent artık /proc/stat'tan gerçek
-- meşguliyeti raporluyor; alarm buna bakacak.
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "cpuBusyPct" INTEGER;
