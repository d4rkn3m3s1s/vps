\pset tuples_only on
\pset format unaligned
\pset fieldsep |
-- ★★★2026-09-12 CİHAZ TABLOSU — /durum'un aranabilir cihaz listesi.
--
-- NEDEN AYRI DOSYA: özet sorguları (durum-ozet.sql) tek satırlık metrikler
-- döndürür; bu ise 144 satır döndürür. Ayrı tutmak, özetin bozulması
-- durumunda tablonun (ya da tersi) ayakta kalmasını sağlar.
--
-- ★TEK GEÇİŞ: alt sorgu yerine LEFT JOIN + GROUP BY. Alt sorgulu sürüm
-- her satır için ayrı tarama yapıyordu (6 cihaz 127 ms → 143 cihaz ~3 sn);
-- bu sürüm TÜM filoyu 101 ms'de veriyor.
--
-- ★EŞLEME ANAHTARI: Device.metadata->>'instance' = 'mi408' — saglik.out'taki
-- instance adıyla birebir eşleşir. Panel telefon numarasını ad olarak tutar,
-- sistem tarafı instance adını; ikisini bir arada göstermek operatörün
-- "paneldeki bu numara hangi cihaz?" sorusunu tek bakışta çözer.
--
-- Alanlar: c|instance|ad|durum|ülke|24s iş|24s başarısız|hesap|son görülme
select 'c|'||coalesce(d.metadata->>'instance','?')||'|'||d.name||'|'||d.status||'|'||
       coalesce(d.metadata->>'proxyCountry','-')||'|'||count(j.id)||'|'||
       count(j.id) filter (where j.status='FAILED')||'|'||
       coalesce(max(g.status::text),'-')||'|'||coalesce(to_char(d."lastSeen",'HH24:MI'),'-')
  from "Device" d
  left join "Job" j on j."deviceId"=d.id and j."createdAt" > now() - interval '24 hours'
  left join "GeneratedAccount" g on g."deviceId"=d.id
 group by d.id, d.name, d.status, d.metadata, d."lastSeen"
 -- ★Sıralama: en çok başarısız iş üstte. Operatör sayfayı açtığında sorunlu
 -- cihazı ARAMAK zorunda kalmasın; tablo zaten onu en üste koysun.
 order by count(j.id) filter (where j.status='FAILED') desc, count(j.id) desc;
