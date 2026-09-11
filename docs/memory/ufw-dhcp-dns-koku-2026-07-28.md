---
name: ufw-dhcp-dns-koku-2026-07-28
description: "★★★TEK-TIK WHATSAPP KIRILMASININ KÖKÜ: ufw, DHCP'nin İLK isteğini düşürüyordu → yeni cihazlar lease ALAMIYOR → Android resolver'ı BOŞ (DnsAddresses: []) → isim çözümü yok → WhatsApp kaydı kırık. IP ile HTTP/HTTPS ÇALIŞIR (301/200) bu yüzden 'internet var' görünür ve sorun GİZLİ kalır. KÖK: DHCP DISCOVER/REQUEST kaynak 0.0.0.0'dan BROADCAST gelir; `ufw allow from 192.168.0.0/16` bunu KAPSAMAZ → INPUT policy DROP → dnsmasq isteği HİÇ görmez. ⚠️ESKİ cihazlar etkilenmez çünkü lease YENİLEME'si UNICAST'tir → sorun sadece YENİ cihazlarda çıkar. TEŞHİS: `iptables -L INPUT -n -v | grep dpt:67` (ufw-skip-to-policy-input sayacı artıyorsa DROP) + tcpdump'ta istek var cevap yok. FIX: wd-firewall-dhcp.sh (waydroid-+ arayüzünde udp/67+53, tcp/53 ACCEPT, before.rules'a kalıcı) + wd-run.sh lease-tohumlama (.112 garanti) + statik-IP fallback 16s→90s. commit c5de056 + 8f531c8"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-28T00:13:23.643Z
---

# ★★★ ufw DHCP'yi düşürüyordu → DNS yok → tek-tık WhatsApp kırık (2026-07-28)

Operatör: *"tek tık whatsapp sorun çıkartır mı bozar mı"* → ÖLÇÜM: 31 cihazın **9'unda
DNS YOKTU**.

## KÖK NEDEN (firewall)
DHCP'nin **İLK** isteği (DISCOVER/REQUEST) kaynak **0.0.0.0**'dan 255.255.255.255'e
**BROADCAST** gelir. Sunucudaki `ufw allow from 192.168.0.0/16` kuralı bunu **KAPSAMAZ**
→ INPUT policy **DROP** → dnsmasq isteği **hiç görmez** → cevap vermez → cihaz lease
alamaz → Android resolver'ı **BOŞ** (`DnsAddresses: []`) → isim çözümü yok →
`web.whatsapp.com` çözülemez → **tek-tık WhatsApp kaydı kırılır**.

⚠️ **Neden gizli kaldı:** IP ile HTTP/HTTPS **çalışıyor** (301/200) → "cihaz internete
çıkıyor" görünüyor. Ayrıca **ESKİ cihazlar etkilenmiyor**: lease **YENİLEME**'si
UNICAST'tir (192.168.x.112 → 192.168.x.1) ve allow kuralına takılır. Bu yüzden semptom
"bazı cihazlarda WhatsApp çalışmıyor" şeklinde çıkar.

## ★ TEŞHİS SIRASI (bu sırayla bak)
1. `dumpsys connectivity | grep DnsAddresses` → boş `[ ]` ise DNS yok (çalışan: `[/192.168.<sub>.1]`)
2. IP ile vs isimle: `curl http://1.1.1.1` (301 ✓) ama `curl https://www.google.com` (000 ✗) → DNS
3. `cat /var/lib/misc/dnsmasq.waydroid-<inst>.leases` → BOŞ ise lease hiç alınmamış
4. `tcpdump -i waydroid-<inst> port 67` → istek VAR, cevap YOK → sunucu tarafı
5. `iptables -L INPUT -n -v | grep dpt:67` → **`ufw-skip-to-policy-input` sayacı artıyorsa DROP** ★

## FIX (commit c5de056 + 8f531c8)
1. **`deploy/kvm-host/waydroid/wd-firewall-dhcp.sh`** (YENİ): `waydroid-+` arayüzlerinde
   udp/67 + udp/53 + tcp/53 ACCEPT; canlı iptables + `/etc/ufw/before.rules`'a kalıcı
   (ufw reload/reboot dayanıklı), idempotent.
2. **`wd-run.sh` lease-TOHUMLAMA**: dnsmasq havuzdan `.113` verebiliyor ama sistemin her
   yeri `192.168.<sub>.112` varsayar → ADB cihazı bulamaz ("offline"). Instance
   başlamadan önce lease dosyası BOŞ/YOK ise `.112` yazılır; dnsmasq açılışta mevcut
   lease'i onurlandırır → cihaz `.112`'yi **gerçek DHCP** ile alır. Dolu lease'e dokunulmaz.
3. **agent.mjs**: statik-IP fallback ~16s → **~90s** (`FLEET_PROV_STATIC_AFTER`), DHCP
   bekleme 60s→110s, boot adım-timeout 150s→240s. Statik adres varken Android DHCP'yi
   tamamlamıyor → fallback artık gerçek son-çare.

## CANLI KANIT
- Fix sonrası ilk kurulum (mi33): lease DOLU `192.168.34.112`, `DnsAddresses [/192.168.34.1]`,
  isimle HTTPS **200**, `web.whatsapp.com` **200**, çıkış TR/Ankara = beklenen TR.
- Geçiş artığı 4 cihaz (`.113`'te kalmıştı) tohumlama ile onarıldı → hepsi `.112`+DNS-OK.
- **FİLO: 26/26 TAM SAĞLIKLI** (ip `.112`, TCP 301, DNS-OK).
- Kalıntı denetimi temiz: DB 26 = HOST 26; bridge/dnsmasq/redsocks/binderfs/lease/systemd
  kalıntısı yok.

## ★★ HIZ: 173s → 90s (boot 114s → 31s) — commit b5400c8
DNS düzeltmesi kurulumu 130s→173s'ye çıkarmıştı. Ölçüm gösterdi ki **DHCP zaten hızlı**:
dnsmasq logunda **DHCPACK boot'un ~22. saniyesinde** geliyor. Sorun **tespitteydi** —
IP container-içi `lxc-attach ... ip -4 addr show eth0` ile **3s timeout**la okunuyordu ve
yoğun boot sırasında BOŞ dönüyordu → provision mevcut IP'yi göremiyor → 92s'de gereksiz
statik fallback → boot 114s.
- **Fix 1:** IP artık ÖNCE **host-tarafı lease dosyasından** okunuyor (anında, container
  yüküne bağımsız). Tohumlanan kayıt (`expiry 4102444800`) SAYILMAZ → yanlış-pozitif yok.
- **Fix 2:** `dhcpKick` zararsızlaştırıldı. Eskiden `ifconfig eth0 DOWN; up; ndc ...;
  dhcptool eth0` idi; ÖLÇÜLDÜ: bu imajda **`dhcptool` YOK**, **`ndc` "Command not
  recognized"** → kick'in DHCP-isteme kısmı hiç çalışmıyordu, geriye link'i DOWN/UP etmek
  kalıyordu ve bu Android'in **devam eden DHCP'sini** her 10s'de yeniden başlatıyordu.
  Artık sadece `up`.
- SONUÇ: **90s | boot=31s** — orijinal 130s'den **%31 hızlı** ve DNS de VAR.
  (mi29: boot@24s DHCP+ADB, boot@31s boot_completed, DnsAddresses ✓, WA 200, TR/Denizli.)

Bağlantılı: [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]] [[container-ip-path-koku-2026-07-28]]
[[firewall-ipv6-regresyon-test-2026-07-24]]
