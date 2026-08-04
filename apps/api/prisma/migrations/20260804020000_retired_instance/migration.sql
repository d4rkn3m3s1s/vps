-- ★2026-08-04 İSİM MEZARLIĞI
-- Bir kez kullanılmış Waydroid instance adları burada kalır ve BİR DAHA
-- tahsis edilmez. Operatör isteği: "mi47'yi silersem bir daha kurulmasın".
-- Proje migration'ları idempotent uygulandığı için IF NOT EXISTS guard'lı.

CREATE TABLE IF NOT EXISTS "RetiredInstance" (
    "id"        TEXT NOT NULL,
    "hostId"    TEXT NOT NULL,
    "instance"  TEXT NOT NULL,
    "reason"    TEXT,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetiredInstance_pkey" PRIMARY KEY ("id")
);

-- Aynı host'ta aynı ad iki kez emekli edilemez (tahsis kontrolü bu çift üzerinden).
CREATE UNIQUE INDEX IF NOT EXISTS "RetiredInstance_hostId_instance_key"
    ON "RetiredInstance" ("hostId", "instance");

CREATE INDEX IF NOT EXISTS "RetiredInstance_hostId_idx"
    ON "RetiredInstance" ("hostId");

-- ★GERİYE DÖNÜK TOHUMLAMA: bu tablo yokken silinmiş cihazların adları kayıptı,
-- ama işlerin geçmişinde duruyorlar. DEVICE_DESTROY işleri "hangi instance yok
-- edildi" bilgisini payload'da taşır — onları emekli listesine alıyoruz ki
-- tablo açıldıktan sonra ESKİ bir ad yanlışlıkla yeniden kullanılmasın.
--
-- Host eşlemesi: işin `claimedByHostId`'si (talep edilmemişse NULL olabilir) →
-- yoksa filodaki TEK host'a düşülür. Bu fleet tek hostlu; çok hostlu bir kuruluma
-- geçilirse yalnızca bu geriye-dönük satırlar yaklaşık olur, YENİ kayıtlar zaten
-- cihazın gerçek hostId'siyle yazılır (device.service.ts).
INSERT INTO "RetiredInstance" ("id", "hostId", "instance", "reason", "retiredAt")
SELECT
    md5(random()::text || clock_timestamp()::text || t.instance),
    t."hostId",
    t.instance,
    'backfill:device_destroy',
    t.first_seen
FROM (
    SELECT
        COALESCE(
            MIN(j."claimedByHostId"),
            (SELECT h.id FROM "Host" h ORDER BY h."createdAt" LIMIT 1)
        )                                AS "hostId",
        j."payload"->>'instance'         AS instance,
        MIN(j."createdAt")               AS first_seen
    FROM "Job" j
    WHERE j."type" = 'DEVICE_DESTROY'
      AND j."payload"->>'instance' IS NOT NULL
      AND j."payload"->>'instance' <> ''
    GROUP BY j."payload"->>'instance'
) t
WHERE t."hostId" IS NOT NULL
  -- ★ŞU AN KULLANIMDA OLAN ADI EMEKLİYE ALMA. Bir ad geçmişte silinip SONRA
  -- yeniden kurulmuş olabilir (canlıda 43 adayın 22'si tam olarak böyleydi:
  -- mi12/mi13/mi30… hepsi ONLINE cihazlarda kullanılıyordu). Onları emekli
  -- saymak tabloyu yanıltıcı yapardı — mezarlık YALNIZCA gerçekten silinmiş
  -- ve geri dönmemiş adları içermeli.
  AND NOT EXISTS (
      SELECT 1 FROM "Device" d WHERE d."metadata"->>'instance' = t.instance
  )
ON CONFLICT ("hostId", "instance") DO NOTHING;
