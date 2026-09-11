---
name: saglamlik-dns-heal-canary-2026-07-28
description: "Sağlamlık paketi: (1) DNS SELF-HEAL — cihaz IP+route+proxy TAM olsa bile DNS'siz kalabilir → TCP 301 döner, ONLINE görünür ama isim çözemez → WhatsApp SESSİZCE kırılır (31 cihazın 9'u böyleydi, hiçbir kontrol yakalamıyordu). UCUZ TESPİT: DNS'i yalnızca DHCP getirir → lease dosyasında GERÇEK lease (tohum expiry=4102444800 HARİÇ) yoksa DNS de yok; ADB/dumpsys maliyeti sıfır. ONARIM: lease'i .112 tohumla + container restart. Koruma: busyDevices/provisioningInstances, tick başına 1 cihaz, cihaz başına saatte 1. (2) CANARY wd-canary.sh + systemd timer (günlük 04:30): gerçek cihaz kurar → DNS+çıkış+WhatsApp+ülke doğrular → siler; başarısızlıkta health-alert. ★TUZAK: agent LOGUNU grep'leme (instance adları geri-dönüşümlü, eski 'DONE mi33' eşleşir) → provision/status API kullan; temizlik TERMİNAL durum beklemeden silmesin (kurulum ortasında silince yarım dizin → Magisk FAIL/boot TIMEOUT) + flock şart. (3) FLEET_THORDATA_TOKEN eklendi (yoksa kota alarmı hiç çalışmaz → sessiz ban riski). commit 0558ef8"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-28T00:53:46.142Z
---

# Sağlamlık paketi: DNS self-heal + canary + bakiye alarmı (2026-07-28)

## 1) DNS SELF-HEAL (`dnsSelfHealTick`, agent)
**Yakaladığı sessiz arıza:** cihazın IP'si, route'u ve proxy'si TAM olsa bile **DNS'siz**
kalabilir. O halde `curl http://1.1.1.1` → **301** döner, panelde **ONLINE** görünür, ama
isim çözemez → `web.whatsapp.com` çözülemez → **WhatsApp kaydı sessizce kırılır**.
31 cihazın **9'u** bu durumdaydı ve mevcut kontrollerin hiçbiri yakalamıyordu (hepsi
IP/route/proxy bakıyordu; DNS'e kimse bakmıyordu).

**Ucuz tespit:** DNS'i yalnızca DHCP getirir → host-tarafı lease dosyasında **gerçek** bir
lease (`wd-run.sh` tohumu `expiry=4102444800` **hariç**) yoksa DNS de yoktur. Dosya okuma;
ADB/dumpsys maliyeti yok, container yükünden etkilenmez.

**Onarım (kanıtlanmış tek yol):** lease'i `.112` ile tohumla + container restart →
Android açılışta gerçek DHCP yapar, DNS gelir. (mi12/mi13/mi14/mi19'da doğrulandı.)

**Koruma:** `busyDevices` (iş yapan cihaza dokunma), `provisioningInstances`, tick başına
**1 cihaz**, aynı cihaz için **saatte 1 kez**. CANLI: 32 cihazda **0 yanlış tetikleme**.

## 2) CANARY (`wd-canary.sh` + `wd-canary.timer`, günlük 04:30)
Gerçek cihaz kurar → **DNS + internet-çıkış + WhatsApp erişimi + proxy ÜLKESİ** doğrular →
cihazı siler. Başarısızlıkta `/agent/health-alert` (webhook + Telegram).
Bugünkü DNS hatasını **ilk gün** yakalardı — biz haftalarca fark etmedik.
CANLI: *"OK: kurulum+DNS+çıkış+WhatsApp+ülke(TR) doğrulandı"*, 103s, kalıntı yok.

### ★★ Canary yazarken düşülen 2 TUZAK (tekrarlama)
1. **Agent logunu grep'leme.** İlk sürüm `DONE <inst>` arıyordu; instance adları
   **geri-dönüşümlü** olduğu için **aynı günün eski kurulumundan** kalma satır eşleşti →
   canary cihaz daha boot ederken kontrol etti → **yanlış alarm**. Doğru kaynak:
   `GET /provision/status/<jobId>` (geçmişe karışmaz).
2. **Temizlik, kurulum bitmeden silmemeli.** İlk sürümde `trap cleanup EXIT` koşulsuzdu;
   erken çıkışta cihaz **kurulumun ortasında** silindi → agent'ın devam eden provision'ı
   yarım dizinde patladı (*"instance data dizini yok"*, Magisk FAIL, boot TIMEOUT) ve
   sonraki canary aynı instance adına çakıştı. FIX: önce **terminal durum** bekle
   (COMPLETED/FAILED/CANCELLED), sonra sil + **`flock` ile tek-çalışma kilidi**.

## 3) THORDATA BAKİYE ALARMI
`FLEET_THORDATA_TOKEN` sunucuda **hiç tanımlı değildi** → `checkThordataCredit` sessizce
atlıyordu → **kota bitse bile uyarı gelmiyordu** (kota bitince proxy çalışmaz → cihaz
datacenter IP'ye düşer → **ban**). Token `fleet-api` `proxy.conf` drop-in'ine eklendi.
Doğrulama: bakiye **10670 MB (~10.4 GB)**, son kullanma **2026-08-27**, eşik 2 GB.
(Kod `traffic_balance`'ı MB kabul edip 1024'e böler.)

## 4) ★ALARM ZİNCİRİ AÇIĞI: CANARY_FAILED Telegram'a ULAŞMIYORDU (commit 2f6eecf)
Operatör *"bunların hepsi Telegram'a gidiyor mu?"* diye sordu → **gitmiyordu**.
`/agent/health-alert`'in zod şeması `kind`'i **enum** ile sınırlıyor; `CANARY_FAILED`
listede olmadığı için istek **400** ile reddediliyordu → alert motoruna hiç ulaşmıyordu.
Ayrıca bilinmeyen kind'larda `trigger` **null** kalıyor → `alertsService.evaluate` hiç
çağrılmıyor → Telegram yolu tamamen kapalı.
**FIX:** enum'a `CANARY_FAILED` + başlık + `trigger = JOB_FAILED` eşlemesi. `JOB_FAILED`,
`alerts.service`'teki **`CRITICAL_FAILOPEN`** kümesinde olduğu için **kural tanımlı
olmasa bile** Telegram'a düşer (yeni `AlertTrigger` enum değeri / DB migration gerekmez).
**KANIT:** `notify sent {"channel":"telegram","title":"🚨 CANARY BAŞARISIZ — ..."}`.

★ Alarm eklerken **her zaman** iki yeri kontrol et: (a) zod `kind` enum'u (yoksa 400),
(b) `trigger` eşlemesi + `CRITICAL_FAILOPEN` üyeliği (yoksa kural yoksa sessiz kalır).
Denetim sonucu: `PROXY_CREDIT_LOW` zaten CRITICAL_FAILOPEN'da ✓, telegram kanalı active ✓,
7 kural aktif (FLEET_MASS_OFFLINE/HOST_SATURATED/HOST_OFFLINE/PROXY_UNHEALTHY/
DEVICE_OFFLINE/JOB_FAILED/ACCOUNT_BANNED, hepsi notify:true).

## 5) Telegram `/bakiye` (alias `/kota`)
thordata kalan trafik + son kullanma, renk kodlu (🔴<2GB 🟡<5GB 🟢). ⚠️Bot API içinde
çalışır; canary ve DNS taraması **host tarafında** koştuğu için onlar bot komutu olarak
eklenmedi (host-çalıştırma job tipi gerekir — ayrı bir karar).

Bağlantılı: [[ufw-dhcp-dns-koku-2026-07-28]] [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]]
[[proxy-eu-pr-endpoint-koku-2026-07-28]] [[telegram-13-komut-suite-2026-07-24]]
