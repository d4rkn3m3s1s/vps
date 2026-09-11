---
name: health-watch-kurtarma-cihazi-bozuyordu-2026-08-05
description: "🔴★★★ health-watch KURTARMA MANTIĞI cihazı BOZUYORDU (mi46: 228 restart/258 ZOMBIE). upstream_ok `http://1.1.1.1` çekiyordu→düz-IP 301 döner test GEÇER ama gerçek HTTPS ÖLÜ. Script yanlış testine güvenip config'i EZİYOR, kurtaramayınca BOZUK BIRAKIYOR (geri alma yok). ★★★Operatörün elle düzeltmesini 11 SANİYEDE geri ezdi→script kapatılmadan manuel fix İMKANSIZ"
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-05T15:28:43.218Z
---

# health-watch kurtarma mantığı cihazı BOZUYORDU (mi46)

## Belirti
mi46 saatlerdir panelde online/offline **flap** ediyordu. Agent logunun **%77'sini
tek başına** üretiyordu (2159 satır; ikinci sıradaki mi13'ün 3.5 katı).
**228 restart / 258 ZOMBIE** — filoda restart sayısı sıfırdan farklı TEK instance.

⚠️ OOM **DEĞİL**: RAM 115/250 GB, 134 GB müsait. Bellek baskısı yoktu.

## ★★★ KÖK NEDEN — script KENDİ TESTİNİ KANDIRIYORDU

`upstream_ok` şunu çekiyordu: `http://1.1.1.1` (**düz IP + düz HTTP**).
Bu istek proxy'nin **çıkış havuzunu gerçekten kullanmıyor** — upstream düz-IP'ye
301 dönüp testi **GEÇİRİYOR**, ama aynı kombinasyonla gerçek trafik ÖLÜ.

**ÖLÇÜLDÜ:** residential+TR → `1.1.1.1` testi geçer, `ipinfo.io` HTTPS = **000**.

⚠️ Bu, [[saglamlik-dns-heal-canary-2026-07-28]]'deki *"DNS'siz cihaz TCP 301 döner
ONLINE görünür ama isim çözemez"* tuzağının **BİREBİR AYNISI**. Aynı tuzak, farklı
katmanda tekrarlamış.

## Nedensellik zinciri
```
mi46 TR isterken residential(5555) havuzundaydı  ← İMKANSIZ (TR yalnızca mobile 9999)
  → çıkış yok → ADB düşer → "ZOMBIE" teşhisi → SIGKILL → restart
  → proxy hâlâ imkânsız → başa dön   (228 kez)
```
Paneldeki flapping bu döngünün restart adımıydı — **belirti, sebep değil**.

## ★★★ EN KRİTİK BULGU: script manuel düzeltmeyi GERİ EZİYOR
Script yanlış testine güvenip *"diğer hesap TR veriyor"* diyerek config'i **EZİYOR**,
kurtaramayınca da **bozuk hâlde BIRAKIYORDU** (geri alma yok).

**Canlı yakalandı:**
- `15:01:18` — operatörün elle yazdığı düzeltmeyi gördü
- `15:01:29` — **GERİ EZDİ** (11 saniye)

→ **Script kapatılmadan hiçbir manuel düzeltme kalıcı olamıyordu.** Bu yüzden
"önce cihazı düzelt, sonra kodu" sırası ÇALIŞMAZ; önce KOD düzeltilmeli.

## FIX (3 katman) — `deploy/kvm-host/wd-health-watch.sh`
1. **`upstream_ok`** artık HTTPS + isim-çözümlemeli gerçek uç nokta; yalnızca `200`
   kabul (CONNECT tüneli kurulamıyorsa havuz gerçekten ölüdür).
2. **`cc_port_ok` + ADIM 0** — ülke↔port uyumsuzluğu kurtarmadan ÖNCE düzeltiliyor;
   "hesap değiştir" adımına guard → ülkeyi artık **yanlış havuza taşıyamaz**.
3. **Ardışık-başarısızlık limiti (6)** → `DEGRADED` işaretle, restart'ı DURDUR, TEK
   bildirim. Sayaç cihaz ADB'ye dönünce sıfırlanır (`/var/lib/wd-health/zfail-<inst>`).
   Sonsuz döngü artık **yapısal olarak imkânsız**.

## Doğrulama
`bash -n` temiz + **7/7 birim testi** (cc_port_ok TR/GB/AL/US × doğru/yanlış port;
port okuma `local_port`'u DEĞİL upstream'i alıyor — config'te ikisi de "port =").

**CANLI SONUÇ:** mi46 çıkış `78.173.92.222` (Bursa, Türk Telekom) · WhatsApp **200** ·
**NRestarts 230 → 0**. Script 15:19'da tekrar dokundu ve portu **9999'da BIRAKTI**
(eski sürüm 5555'e ezerdi) → guard canlıda kanıtlandı.

## ⚠️ Yan bulgular
- **netd resolver** ayrıca ölmüştü (`ping: unknown host`, `ndc getnetdns` boş) —
  `systemctl restart waydroid@mi46` kurtardı. [[mi46-netd-resolver-adb-uc-karisikligi-2026-07-30]]
  ile **aynı arıza, aynı cihaz, tekrarlamış**.
- **default route yok**du; agent'ın yöntemi:
  `lxc-attach -n waydroid -P /var/lib/waydroid.<inst>/lxc -- /system/bin/ip route add
  default via 192.168.<sub>.1 dev eth0 ... table {main,local_network,eth0}`
- `/etc/fleet-proxy.env` **600/root** → `sudo bash -c "set -a; . ..."` gerekir.
- ⚠️ Waydroid'de **`adb root` YOK** ("not available in Waydroid") → root iş için
  `lxc-attach` kullan.
- ⚠️ Host'ta ADB yolu `/usr/bin/adb` (`/opt/fleet-agent/platform-tools/adb` YOK).

İlgili: [[proxy-mimari-cok-port-2hesap-2026-07-21]] ·
[[api-restart-agent-stream-proxy-tasima-2026-07-29]] (TR→mobile 9999, AL→residential 5555) ·
[[saglamlik-dns-heal-canary-2026-07-28]] · [[cpu-alarm-load-yaniltici-2026-08-05]]
