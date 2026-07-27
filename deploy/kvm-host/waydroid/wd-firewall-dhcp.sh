#!/bin/sh
# ★★ KOK-FIX 2026-07-28 — Waydroid bridge'lerinde DHCP + DNS'e izin ver.
#
# SORUN: ufw etkinken cihazlar DHCP lease ALAMIYOR -> Android'in resolver'i BOS kaliyor
# (DnsAddresses: []) -> cihaz isim cozemiyor -> tek-tik WhatsApp kaydi KIRILIYOR
# (https://g.whatsapp.net / web.whatsapp.com cozulemez). IP ile HTTP/HTTPS calisir,
# bu yuzden "internet var" gorunur ve sorun gizli kalir.
#
# KOK: DHCP'nin ILK istegi (DISCOVER/REQUEST) kaynak 0.0.0.0'dan 255.255.255.255'e
# BROADCAST gelir. `ufw allow from 192.168.0.0/16` kurali bunu KAPSAMAZ (kaynak 0.0.0.0)
# -> INPUT policy DROP -> dnsmasq istegi HIC gormez -> hic cevap vermez.
# CANLI KANIT: `iptables -L INPUT -n -v` -> "ufw-skip-to-policy-input udp dpt:67" 3556 paket;
# tcpdump'ta 7 istek var, 0 cevap; dnsmasq loglarinda hicbir DHCP islemi yok.
# ⚠️ ESKI cihazlar etkilenmedi cunku lease YENILEME'si UNICAST'tir (192.168.x.112 ->
# 192.168.x.1) ve `allow from 192.168.0.0/16` kuralina takilir. Bu yuzden sorun sadece
# YENI kurulan cihazlarda gorunur ve "bazi cihazlarda WhatsApp calismiyor" seklinde cikar.
#
# KANIT (fix sonrasi): yeni cihaz lease aldi (dnsmasq.waydroid-<inst>.leases dolu),
# DnsAddresses: [ /192.168.<sub>.1 ], isimle HTTPS 200, web.whatsapp.com 200.
#
# Kullanim: sudo sh wd-firewall-dhcp.sh    (idempotent; ufw reload'a dayanikli)
set -eu

RULES=/etc/ufw/before.rules
MARK='waydroid-+ -p udp --dport 67'

# 1) Canli iptables (aninda etkili)
for R in "-p udp --dport 67" "-p udp --dport 53" "-p tcp --dport 53"; do
  # shellcheck disable=SC2086
  iptables -C ufw-before-input -i waydroid-+ $R -j ACCEPT 2>/dev/null || \
  iptables -I ufw-before-input 1 -i waydroid-+ $R -j ACCEPT
done

# 2) Kalici (ufw reload / reboot sonrasi da dursun)
if [ -f "$RULES" ] && ! grep -q "$MARK" "$RULES"; then
  cp "$RULES" "$RULES.bak-dhcp-$(date +%s)"
  awk '
    /^# allow all on loopback/ && !done {
      print "# KOK-FIX 2026-07-28: Waydroid bridge DHCP(67)+DNS(53) — DHCP ILK istegi 0.0.0.0";
      print "# BROADCAST oldugu icin `allow from 192.168.0.0/16` KAPSAMAZ -> policy DROP ->";
      print "# lease alinamaz -> Android DNS BOS -> tek-tik WhatsApp kirilir. Detay: bu script.";
      print "-A ufw-before-input -i waydroid-+ -p udp --dport 67 -j ACCEPT";
      print "-A ufw-before-input -i waydroid-+ -p udp --dport 53 -j ACCEPT";
      print "-A ufw-before-input -i waydroid-+ -p tcp --dport 53 -j ACCEPT";
      print "";
      done=1
    }
    { print }
  ' "$RULES" > "$RULES.tmp" && mv "$RULES.tmp" "$RULES"
  echo "before.rules guncellendi (kalici)"
fi

echo "DHCP/DNS izinleri aktif:"
iptables -L ufw-before-input -n -v 2>/dev/null | grep 'waydroid-+' || true

# ★ DOGRULAMA: yeni bir cihaz kurduktan sonra
#   cat /var/lib/misc/dnsmasq.waydroid-<inst>.leases        -> DOLU olmali
#   adb -s <ip>:5555 shell dumpsys connectivity | grep DnsAddresses -> [ /192.168.<sub>.1 ]
#   adb -s <ip>:5555 shell "su -c 'curl -sk -o /dev/null -w %{http_code} https://web.whatsapp.com'" -> 200
