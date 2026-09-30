\pset tuples_only on
\pset format unaligned
\pset fieldsep |
-- ★★★2026-09-12 /durum DB ozeti. Her satir "anahtar|deger[|deger...]".
-- 90 sn'de bir wd-durum-db.service calistirir; sayfa yalnizca dosyayi okur.
-- ★TASARIM KURALI: her sorgu 24 saatlik pencerede ve indexli kolon uzerinde.
-- Olculen toplam sure: ~140ms. Sayfa dongusu 10sn oldugu icin DB'ye her turda
-- gidilmez -- yoksa gunde ~8600 gereksiz sorgu olur VE sayfa DB'ye bagimli
-- hale gelir (DB yavaslarsa durum sayfasi da donar, ariza aninda tam ters sey).

-- ══════════════════════════════════════════════════════════════════════════
-- IS AKISI
-- ══════════════════════════════════════════════════════════════════════════
select 'is24', count(*) filter (where status='COMPLETED'), count(*) filter (where status='FAILED')
  from "Job" where "createdAt" > now() - interval '24 hours';

-- Gonderim medyani (sn): isin BASLAMASINDAN bitisine. Olculen tipik: 13-14sn.
select 'gonderim_med', coalesce(round(percentile_cont(0.5) within group
    (order by extract(epoch from ("finishedAt"-"startedAt"))))::text,'?')
  from "Job" where type='WHATSAPP_SEND' and status='COMPLETED'
   and "finishedAt" is not null and "startedAt" is not null
   and "createdAt" > now() - interval '24 hours';

-- Gonderim p95: medyan iyiyken kuyrugun kotu oldugu durumu yakalar.
select 'gonderim_p95', coalesce(round(percentile_cont(0.95) within group
    (order by extract(epoch from ("finishedAt"-"startedAt"))))::text,'?')
  from "Job" where type='WHATSAPP_SEND' and status='COMPLETED'
   and "finishedAt" is not null and "startedAt" is not null
   and "createdAt" > now() - interval '24 hours';

-- Kuyruk beklemesi (sn): is OLUSTURULDUKTAN sonra kac sn bekledi.
-- ★AYRI olculur: "yavas" sikayetinin iki koku var -- cihaz yavas (gonderim_med
-- buyur) ya da is kuyrukta bekliyor (kuyruk_med buyur). Ayirmazsan teshis kor.
select 'kuyruk_med', coalesce(round(percentile_cont(0.5) within group
    (order by extract(epoch from ("startedAt"-"createdAt"))))::text,'?')
  from "Job" where status='COMPLETED' and "startedAt" is not null
   and "createdAt" > now() - interval '24 hours';

select 'bekleyen', count(*) from "Job" where status in ('PENDING','RUNNING');

-- En cok basarisiz olan TEK cihazin sayisi. ★Bu ayrim her seyi degistirir:
-- basarisizligin cogu tek cihazdaysa o cihaz arizali, dagilmissa sistemik.
select 'fail_cihaz', coalesce(max(t.n)::text,'0')
  from (select count(*) n from "Job" where status='FAILED'
         and "createdAt" > now() - interval '24 hours'
         and "deviceId" is not null group by "deviceId") t;

-- En sik hata metni (kok neden tek bakista).
select 'jobfail_sebep', coalesce(max(t.r),'-')
  from (select left(error,52) r, count(*) n from "Job"
         where status='FAILED' and "createdAt" > now() - interval '24 hours'
           and error is not null group by left(error,52) order by count(*) desc limit 1) t;

-- Is tipi kirilimi: en yogun 4 tip "TIP:ok/fail" bicimde tek satirda.
select 'is_tipler', string_agg(t.s,' · ' order by t.n desc)
  from (select type||': '||count(*) filter (where status='COMPLETED')||'/'||
               count(*) filter (where status='FAILED') s, count(*) n
          from "Job" where "createdAt" > now() - interval '24 hours'
          group by type order by count(*) desc limit 4) t;

-- Saatlik is egilimi (mini grafik icin): "saat:adet:fail" listesi.
select 'saatlik', string_agg(t.s,',' order by t.h)
  from (select to_char("createdAt",'HH24') h,
               to_char("createdAt",'HH24')||':'||count(*)||':'||
               count(*) filter (where status='FAILED') s
          from "Job" where "createdAt" > now() - interval '24 hours'
          group by to_char("createdAt",'HH24')) t;

-- ══════════════════════════════════════════════════════════════════════════
-- MESAJ TESLIMATI  ★★★BU PROJENIN EN PAHALI KOR NOKTASI
-- 24 Agu: isler "COMPLETED" donuyordu ama mesajlarin dortte biri KARSIYA
-- ULASMAMISTI. Is basarisi ≠ teslimat. Ikisi AYRI olculmeli.
-- ⚠️OLCULEN GERCEK (12 Eyl): statusAt HIC guncellenmiyor (createdAt'a esit),
-- OUT mesajlarin 3115'inden yalnizca 11'i DELIVERED, 6'si READ, 2493'u SENT'te
-- donmus (medyan yas 9 SAAT). Yani "SENT" burada "gonderildi" DEGIL,
-- "teslim onayi hic islenmedi" demek. Sayfa bunu DURUSTCE boyle gostermeli.
-- ══════════════════════════════════════════════════════════════════════════
select 'msg24', count(*) filter (where direction='OUT'), count(*) filter (where direction='IN')
  from "WhatsappMessage" where "createdAt" > now() - interval '24 hours';

select 'msg_out', count(*) filter (where status='SENT'),
                  count(*) filter (where status in ('DELIVERED','READ')),
                  count(*) filter (where status='FAILED')
  from "WhatsappMessage" where direction='OUT' and "createdAt" > now() - interval '24 hours';

-- SENT'te donmus mesajlarin medyan yasi (dakika). Buyukse teslimat izi olu.
select 'sent_yas', coalesce(round(percentile_cont(0.5) within group
    (order by extract(epoch from (now()-"createdAt"))/60))::text,'-')
  from "WhatsappMessage" where direction='OUT' and status='SENT'
   and "createdAt" > now() - interval '24 hours';

select 'msgfail_sebep', coalesce(max(t.r),'-')
  from (select left("failReason",52) r, count(*) n from "WhatsappMessage"
         where "createdAt" > now() - interval '24 hours' and "failReason" is not null
         group by left("failReason",52) order by count(*) desc limit 1) t;

-- ══════════════════════════════════════════════════════════════════════════
-- HESAP SAGLIGI + BAN EGILIMI
-- ★★★4 Agu'de hesaplarin %39'u BIR GECEDE yandi; tek erken sinyal
-- "son 24 saatte kac ban" idi ve hicbir yerde gorunmuyordu.
-- ══════════════════════════════════════════════════════════════════════════
select 'hesap', count(*) filter (where status='ACTIVE'),
                count(*) filter (where status='BANNED'),
                count(*) filter (where status='RESTRICTED')
  from "GeneratedAccount";
select 'hesap_diger', count(*) filter (where status='FAILED'),
                      count(*) filter (where status='LOGGED_OUT')
  from "GeneratedAccount";
select 'ban7', count(*) from "GeneratedAccount"
  where status='BANNED' and "updatedAt" > now() - interval '7 days';
select 'ban24', count(*) from "GeneratedAccount"
  where status='BANNED' and "updatedAt" > now() - interval '24 hours';
select 'kisit24', count(*) from "GeneratedAccount"
  where status='RESTRICTED' and "updatedAt" > now() - interval '24 hours';
-- Gunluk ban serisi (7 gun, mini grafik): "GG:adet" listesi.
select 'ban_seri', coalesce(string_agg(t.s,',' order by t.d),'-')
  from (select to_char("updatedAt",'MM-DD') d, to_char("updatedAt",'DD')||':'||count(*) s
          from "GeneratedAccount" where status='BANNED'
           and "updatedAt" > now() - interval '7 days'
          group by to_char("updatedAt",'MM-DD'), to_char("updatedAt",'DD')) t;

-- ══════════════════════════════════════════════════════════════════════════
-- ALARM AKISI
-- ══════════════════════════════════════════════════════════════════════════
select 'alarm24', count(*) from "AlertEvent" where "createdAt" > now() - interval '24 hours';
select 'alarm_onaysiz', count(*) from "AlertEvent" where acknowledged=false;
select 'son_alarm_zaman', coalesce(to_char(max("createdAt"),'MM-DD HH24:MI'),'-') from "AlertEvent";
select 'son_alarm_baslik', coalesce(left(replace(replace(title,'|',' '),E'\n',' '),64),'-')
  from "AlertEvent" order by "createdAt" desc limit 1;
-- En sik alarm turu (24s) -- tekrar eden ariza tek bakista gorunur.
select 'alarm_sik', coalesce(max(t.s),'-')
  from (select left(replace(title,'|',' '),46)||' ×'||count(*) s, count(*) n
          from "AlertEvent" where "createdAt" > now() - interval '24 hours'
          group by left(replace(title,'|',' '),46) order by count(*) desc limit 1) t;

-- ══════════════════════════════════════════════════════════════════════════
-- PANEL / DB TUTARLILIGI
-- ★11 Eyl: panelde 4 hayalet cihaz vardi (canary instance'i silmis, DB kaydini
-- silmemisti). Iki sayac KARSILASTIRILMAZSA bu gorunmez.
-- ══════════════════════════════════════════════════════════════════════════
select 'db_cihaz', count(*) from "Device";
select 'db_online', count(*) from "Device" where status='ONLINE';
select 'db_bayat', count(*) from "Device"
  where "lastSeen" is null or "lastSeen" < now() - interval '15 minutes';
select 'db_boyut', pg_size_pretty(pg_database_size(current_database()));
select 'db_enbuyuk', coalesce(max(t.s),'-')
  from (select relname||' '||pg_size_pretty(pg_total_relation_size(c.oid)) s,
               pg_total_relation_size(c.oid) n
          from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
         where ns.nspname='public' and c.relkind='r'
         order by pg_total_relation_size(c.oid) desc limit 1) t;
-- Sisme: olu satir orani. Autovacuum esigi %20; buyukse tablo sisiyor.
select 'db_olu', coalesce(max(t.s),'-')
  from (select relname||' %'||round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0)) s,
               n_dead_tup n from pg_stat_user_tables
         where n_dead_tup > 10000 order by n_dead_tup desc limit 1) t;

-- ══════════════════════════════════════════════════════════════════════════
-- ★2026-09-12 EK METRİKLER (ikinci tur)
-- ══════════════════════════════════════════════════════════════════════════

-- ALARM KURALLARI. ★"Onaysız alarm 4132" tek başına anlamsız bir yığın sayısı;
-- kırılımı olmadan operatör neyin tekrar ettiğini göremez. Ölçülen dağılım:
-- DEVICE_OFFLINE 1425 · HOST_SATURATED 959 · JOB_FAILED 801 · PROXY_UNHEALTHY 731.
select 'kural_ozet', count(*) filter (where active), count(*), coalesce(sum("fireCount"),0)
  from "AlertRule";
select 'kural_top', coalesce(string_agg(t.s,' · ' order by t.n desc),'-')
  from (select name||' ×'||"fireCount" s, "fireCount" n from "AlertRule"
         where "fireCount" > 0 order by "fireCount" desc limit 4) t;
-- Son 24 saatte GERÇEKTEN tetiklenen kural var mı? (fireCount kümülatif,
-- lastFiredAt taze olan kuralı gösterir — asıl bakılması gereken bu.)
select 'kural_taze', coalesce(string_agg(name,' · '),'yok')
  from "AlertRule" where "lastFiredAt" > now() - interval '24 hours';

-- KAYDI EKSİK CİHAZ. ★Adı telefon numarası olmayan cihaz = WhatsApp kaydı
-- tamamlanmamış. Bunlar filoda "ONLINE" görünür, iş alır, ama mesaj GÖNDEREMEZ.
-- Ölçülen: 6 cihaz (wa-pkv4, wa-o0tm, wa-woxb, 12, wa-grmr, wa-1lsk).
-- ⚠️metadata->>'waRegisterStatus' GÜVENİLMEZ: 143 cihazda boş, yalnız 1'inde
-- dolu. Ad deseni tek doğru sinyal.
select 'kayitsiz', count(*) from "Device" where name !~ '^\+[0-9]+$';
select 'kayitsiz_liste', coalesce(string_agg(coalesce(metadata->>'instance','?')||' ('||name||')',' · '),'-')
  from (select metadata, name from "Device" where name !~ '^\+[0-9]+$' order by name limit 10) t;

-- EMEKLİ INSTANCE. ★Silinen cihazların izi. 24 saatte ani artış = filo
-- küçülüyor ya da silme döngüsü bozuk demektir.
select 'emekli', count(*), count(*) filter (where "retiredAt" > now() - interval '24 hours')
  from "RetiredInstance";
select 'emekli_son', coalesce(to_char(max("retiredAt"),'MM-DD HH24:MI'),'-') from "RetiredInstance";

-- KONUŞMA HACMİ. ★Gelen mesaj akışının canlılığı: 24 saatte kaç sohbet güncellendi.
select 'konusma', count(*) filter (where "updatedAt" > now() - interval '24 hours'), count(*)
  from "WhatsappConversation";

-- ÜLKE DAĞILIMI (proxy ülkesine göre) — TR/AL ayrımı.
select 'ulke', coalesce(string_agg(t.s,' · ' order by t.n desc),'-')
  from (select coalesce(metadata->>'proxyCountry','?')||': '||count(*) s, count(*) n
          from "Device" group by coalesce(metadata->>'proxyCountry','?')) t;

-- ══════════════════════════════════════════════════════════════════════════
-- ★2026-09-30 YAŞAYAN FİLO + GERÇEK TESLİM
-- Eski 'is24' iş DURUMUNU sayıyordu: agent WHATSAPP_SEND'i hep COMPLETED bitirir,
-- mesajın gidip gitmediği result.status'tadır (canlı: %99 görünüyordu, gerçek %74).
-- Eski 'hesap'/'ban24' TÜM ZAMANLARIN kayıtlarını sayıyordu (silinmiş cihazlar
-- dahil: "24s ban 14" derken yaşayan filoda 1'di).
-- ══════════════════════════════════════════════════════════════════════════
select 'teslim24',
       count(*) filter (where status='COMPLETED' and upper(coalesce(result->>'status','')) in ('SENT','OK','DELIVERED','READ')),
       count(*),
       coalesce((select string_agg(x.k||' '||x.n, ' · ' order by x.n desc) from (
          select coalesce(nullif(result->>'status',''), status::text) k, count(*) n
            from "Job" where type='WHATSAPP_SEND' and status in ('COMPLETED','FAILED')
             and "createdAt" > now() - interval '24 hours'
             and not (status='COMPLETED' and upper(coalesce(result->>'status','')) in ('SENT','OK','DELIVERED','READ'))
           group by 1 order by 2 desc limit 3) x), '-')
  from "Job" where type='WHATSAPP_SEND' and status in ('COMPLETED','FAILED')
   and "createdAt" > now() - interval '24 hours';
-- Yaşayan cihaz başına EN İYİ hesap: aktif|banlı|kısıtlı|çıkış|hesapsız|toplam
select 'hesap_canli',
       count(*) filter (where b='ACTIVE'), count(*) filter (where b='BANNED'),
       count(*) filter (where b='RESTRICTED'), count(*) filter (where b='LOGGED_OUT'),
       count(*) filter (where b is null), count(*)
  from (select (select g.status::text from "GeneratedAccount" g
                 where g."deviceId"=d.id and g.platform='whatsapp'
                   and g.status in ('ACTIVE','RESTRICTED','LOGGED_OUT','BANNED')
                 order by case g.status when 'ACTIVE' then 4 when 'RESTRICTED' then 3
                                        when 'LOGGED_OUT' then 2 else 1 end desc limit 1) b
          from "Device" d where d.metadata ? 'instance') t;
-- Yaşayan cihazda ban (24s | 7g) — cihazda sonradan aktif hesap açıldıysa sayılmaz.
select 'ban_canli',
       count(*) filter (where g."updatedAt" > now() - interval '24 hours'), count(*)
  from "GeneratedAccount" g join "Device" d on d.id=g."deviceId" and d.metadata ? 'instance'
 where g.status='BANNED' and g."updatedAt" > now() - interval '7 days'
   and not exists (select 1 from "GeneratedAccount" a where a."deviceId"=g."deviceId" and a.status='ACTIVE');
