---
name: statik-ip-default-route-eksik-fix-2026-07-27
description: "★★KÖK NEDEN: WhatsApp 'Couldn't connect' + cihaz internete çıkamıyor (TCP 000). Bugünkü statik-IP fallback fix'i (eth0 DHCP gecikince statik IP ata) EKSİKTİ — sadece `ip addr add` + MAIN-tablo default-route yapıyordu AMA Android netstack fwmark-tabanlı ROUTE TABLOLARINI (main/eth0/legacy_system) kullanır; bunlara default-route eklenmezse cihaz internete ÇIKAMAZ. CANLI: mi14 statik-IP aldı, host-tarafı proxy TR-çıkıyor ✓, ama cihazdan `su -c curl http://1.1.1.1` = TCP 000 (mi2-çalışan=301). WhatsApp EULA/numara geçer (cache) ama OTP-doğrulama anında 'Couldn't connect' (yeni bağlantı çıkamaz). FIX: staticEth0 + healInstanceEth0 → default-route'u TÜM tablolara ekle (`for T in main eth0 legacy_system; do ip route add default via GW dev eth0 table $T; done`). DHCP başarılı olsaydı bunu otomatik yapardı; statik atama yapmıyordu. CANLI-KANIT: route eklenince mi14/mi12 TCP 000→301, TÜM 26 cihaz tarandı hepsi OK. ★TEST: `su -c curl -o/dev/null -w %{http_code} http://1.1.1.1`(DNS-siz TCP) 301=çıkabiliyor 000=kopuk — cihaz-içi güvenilir tek test."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-26T21:48:13.103Z
---

# ★★ STATİK-IP FALLBACK default-route EKSİK → internet-kopuk (2026-07-27)

Kullanıcı: tek-tık WhatsApp kaydında "Couldn't connect. Please try again later"
(numara temiz, ban değil). "sistemdeki bütün cihazlar + yeni tek-tık cihazlar +
tek-tık WhatsApp sorunsuz olmalı".

## KÖK NEDEN (statik-IP fix'inin eksiği)
Bugün provision'a statik-IP fallback ekledim (eth0 DHCP gecikince `ip addr add
192.168.<sub>.112/24`). AMA route KISMI eksikti:
- `staticEth0` + `healInstanceEth0` sadece `ip addr add` + link-up + **MAIN-tablo**
  default-route yapıyordu.
- ★Android netstack FWMARK-tabanlı route tabloları kullanır: `main`, `eth0`,
  `legacy_system`. Bunlara default-route eklenmezse uygulamaların (WhatsApp) trafiği
  hiçbir tabloda default bulamaz → cihaz internete ÇIKAMAZ (TCP 000).
- DHCP başarılı olsaydı netd bu tabloları otomatik doldururdu; statik-atama yapmıyordu.

## SEMPTOM ZİNCİRİ (yanıltıcı)
- Host-tarafı upstream proxy testi: TR çıkıyor ✓ (proxy SAĞLAM). iptables REDIRECT ✓, redsocks ✓.
- AMA cihazdan `su -c curl http://1.1.1.1` = **TCP 000** (mi2-çalışan cihaz = 301).
- WhatsApp EULA + numara-ekranı geçer (cache'li bağlantı) ama numara-onay→OTP-doğrulama
  anında YENİ bağlantı gerekir → çıkamaz → "Couldn't connect. Please try again later".
- ⚠️AYIRT ET: proxy-uyumsuzluk DEĞİL (TR-proxy=TR-numara uyumlu), ban DEĞİL (numara temiz),
  DNS-only DEĞİL (ham TCP 1.1.1.1 bile 000). Kök = default-route fwmark-tablolarda YOK.

## FIX (agent.mjs /opt/agent.mjs — 2 fonksiyon)
1. **staticEth0** (provisionDevice DHCP-fallback): `for T in main eth0 legacy_system; do
   ip route add default via 192.168.<sub>.1 dev eth0 table $T; done` + main-tablo.
2. **healInstanceEth0** (adbRecoveryTick oto-kurtarma): aynı fwmark-tablo route ekleme.
- ✅CANLI: route eklenince mi14/mi12 TCP 000→301. TÜM 26 cihaz paralel-tarandı → HEPSİ OK
  (24 zaten-OK + mi12/mi14/mi19 düzeltildi). Filo 26/26 online.
- ✅KALICI: fix agent'ta → yeni tek-tık cihazlar statik-IP fallback'e düşse bile default-route
  otomatik alır → internete çıkar → tek-tık WhatsApp "Couldn't connect" vermez.

## ★ KESİN TEST YÖNTEMİ (cihaz-içi, güvenilir)
`adb -s <ip> shell "su -c \"curl -s -o /dev/null -w %{http_code} --max-time 8 http://1.1.1.1\""`
→ **301/200 = internete çıkabiliyor, 000 = KOPUK**. DNS-siz ham-TCP (1.1.1.1 IP), isim-çözümü
gerektirmez → route/proxy sorununu DNS'ten ayırır. adb-shell curl `/system/bin/curl` her cihazda var.
`ipinfo.io/country`(isim) boş dönerse DNS eksik olabilir ama TCP-301 çıkışın OK olduğunu kanıtlar.

## ★ EK (2. tur): route-TABLO adları + heal IP-var-route-yok
İlk fix `main/eth0/legacy_system` kullandı ama `addInstanceRoutes` GERÇEKTE `main/local_network/
eth0` kullanıyor (legacy_system YANLIŞ, local_network EKSİK). Düzeltildi: staticEth0 +
healInstanceEth0 → `main local_network eth0` + subnet-route. ★★KRİTİK: healInstanceEth0
eskiden `if(hasIp) return 'already-has-ip'` yapıyordu → IP-var-ama-route-YOK cihazı HİÇ
düzeltmiyordu (mi20 boot-sonrası route-kaybı böyle kalıcıydı). FIX: IP varsa default-route
de kontrol et; yoksa SADECE route ekle (IP'ye dokunma) → 'route-added'. adbRecoveryTick
artık ERİŞİLEBİLİR cihazları da healInstanceEth0'a verir (reachSubnets-atlama kaldırıldı) →
route-eksik-ama-reachable cihazları 90s tick'te oto-düzeltir. IP+route tamsa ucuz-geçer.
- ★AÇIK: boot-sonrası route neden siliniyor tam çözülmedi (Android netstack route-adımından
  SONRA tabloları resetliyor olabilir). adbRecoveryTick oto-heal SEMPTOMU kapatıyor (90s'de
  düzeltir) ama KÖK (route-kaybı) kalıcı değil. Gelecek: provision persist-adımından SONRA
  route'u bir kez daha ekle, ya da boot-persist route (Android ip-rule kalıcılaştır).
- CANLI: 25/25 cihaz TCP-301 (mi68 502→proxy+route→301, mi12/14/19/20 route-eklendi).

Detay [[eth0-heal-otomatik-kurtarma-2026-07-24]] [[wa-couldnt-connect-proxy-forcestop-2026-07-27]]
[[proxy-alarm-undici-forward-fix-2026-07-26]]
