---
name: firewall-ipv6-regresyon-test-2026-07-24
description: "★STABİLİTE-TUR2 sonrası KAPSAMLI TEST → 2 GERÇEK REGRESYON yakalandı+düzeltildi. (1)ufw firewall(deny-incoming) cihazların DNS'ini KESTİ→cihaz çıkış-IP boş(TCP çalışıyordu ama DNS çözülmüyordu, ping google.com boş). KÖK: cihaz→host DNS(UDP53) INPUT'ta reddediliyordu, redsocks(12500-12600) izni DNS'i kapsamıyordu. FIX: `ufw allow from 192.168.0.0/16`(waydroid subnet→host TÜM iç trafik) + FORWARD_POLICY DROP→ACCEPT. (2)API localhost-bind(127.0.0.1) sonrası WS 502: Caddy `reverse_proxy localhost:4000`→localhost IPv6(::1)çözülüyor ama API sadece IPv4(127.0.0.1) dinliyor→WS upgrade kırık. FIX: Caddyfile localhost→127.0.0.1(tüm reverse_proxy). ★DERS: firewall+localhost-bind değişikliğinden sonra MUTLAKA cihaz-DNS + WS test et."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-24T00:35:07.040Z
---

# ★ FIREWALL + IPv6 REGRESYONLARI — TEST YAKALADI (2026-07-24)

Stabilite-TUR2 sertleştirmeleri (ufw firewall + API localhost-bind) uygulandıktan
SONRA kullanıcı "test et bakalım bir şey bozuldu mu" dedi. KAPSAMLI 7-test yapıldı,
**2 GERÇEK REGRESYON** yakalandı+düzeltildi. Test-etmenin değerinin kanıtı.

## 🔴 REGRESYON 1: ufw firewall cihazların DNS'ini KESTİ
- SEMPTOM: 5 cihazın hepsi çıkış-IP BOŞ döndü (curl api.ipify.org → boş, ping google.com → boş).
- ★AYIRT EDİCİ TEST: DNS-siz TCP (`curl http://1.1.1.1` → 301 ÇALIŞIYOR) ama DNS-li (isim) → BOŞ.
  Yani proxy/redsocks zinciri SAĞLAMDI, sadece DNS çözümü kırıktı.
- KÖK: `ufw default deny incoming` → cihaz→host DNS(UDP 53, dnsmasq gateway 192.168.X.1:53)
  INPUT'ta reddediliyordu. Madde-3'te eklenen `ufw allow from 192.168.0.0/16 port 12500:12600`
  SADECE redsocks-TCP'yi açtı, DNS(53/UDP)'i DEĞİL. `FORWARD policy DROP` da 6586 paket düşürüyordu.
- ✅ FIX: (a)`sudo ufw allow from 192.168.0.0/16`(waydroid subnet→host TÜM iç trafik: DNS+DHCP+redsocks).
  (b)`/etc/default/ufw` DEFAULT_FORWARD_POLICY="DROP"→"ACCEPT"(waydroid kendi iptables kurallarıyla
  yönetiyor, ufw'nun forward-kesmesi yanlıştı). `ufw reload`.
- ✅ SONUÇ: 4 cihaz TR-IP'den çıkıyor(212.252.73.7/78.190.105.196/88.227.73.75/78.190.54.224),
  datacenter-sızıntı YOK. Firewall güvenliği KORUNDU(:4000/:12502 dışarıdan hâlâ 000-kapalı).

## 🔴 REGRESYON 2: API localhost-bind → WS 502 (IPv4/IPv6 uyumsuzluk)
- SEMPTOM: `/ws/devices` Caddy üzerinden 502. Ama 8 aktif WS-ESTAB bağlantı vardı(kafa karıştırıcı).
- ★KÖK(klasik IPv4/IPv6): API `server.listen(port,'127.0.0.1')`=SADECE IPv4 dinliyor. Caddy
  `reverse_proxy @ws localhost:4000` → `localhost` → `::1`(IPv6) çözülüyor → `[::1]:4000` → 000 →
  Caddy 502. HTTP fallback-retry ile çalışıyordu ama WS-upgrade retry yapamıyor.
- ✅ FIX: Caddyfile'da `localhost:4000`/`localhost:3000` → `127.0.0.1:4000`/`127.0.0.1:3000`
  (tüm reverse_proxy, sed). `systemctl reload caddy`.
- ⚠️AMA: WS test-handshake'i (token'sız) HÂLÂ 502 döndü → bu YANLIŞ-ALARM: `/ws/devices` JWT-token
  ŞART(device.hub.ts:78 "No token→reject socket.destroy()"). Token'sız handshake güvenlik-reddi=DOĞRU.
  GERÇEK KANIT: 6 aktif WS bağlantı Caddy/localhost'tan geliyor=WS ÇALIŞIYOR. IPv4-fix yine de doğru
  (gelecekteki tutarsızlığı önler).

## ✅ BOZULMAYAN (7-test, hepsi geçti)
- T1 site/servisler(4 active, localhost-bind), T2 WhatsApp SEND(COMPLETED+SENT, agent çalışıyor),
  T3 Public API(Caddy /public route + auth 401), T4 agent job-claim(localhost:4000, claim-failed 0),
  T5 cihaz+proxy(REGRESYON1 sonrası TR-IP), T6 rate-limit+login(trust-proxy düzeltti, 401 doğru),
  T7 WS(6 aktif, REGRESYON2 sonrası).

## 🎓 DERS
Firewall(ufw) + uygulama-bind değişikliğinden SONRA MUTLAKA test et: (1)cihaz-DNS(isim-çözümü,
sadece TCP değil), (2)WS-upgrade(IPv4/IPv6 localhost tutarlılığı), (3)proxy-çıkış-IP. `curl http://IP`
(DNS-siz) vs `curl http://isim`(DNS-li) ayrımı DNS-kırığını TCP-kırığından ayırt eder.
Detay [[sunucu-kasma-cozum-5ajan-2026-07-24]].
