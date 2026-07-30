#!/bin/bash
# wd-mac-rollout.sh — filo geneli MAC devreye alma.
#
# ★2026-07-30. MAC yalnızca instance YENİDEN BAŞLADIĞINDA geçerli olur (LXC config'de
# saklanır, konteyner içinden değiştirilemez). wd-mac-unique.sh MAC'leri config'e yazdı;
# bu betik onları sırayla devreye alır.
#
# SIRA: aktif WhatsApp hesabı OLMAYAN cihazlar ÖNCE (risk düşük), hesaplılar SONRA.
# Her cihaz TEK TEK yeniden başlatılır ve ADB'ye dönmesi BEKLENİR — eşzamanlı boot
# binder/DBus runtime'ında çakışıyor (kanıtlandı: 33 wd-run → 14 cihaz düştü).
#
# ⚠️ pkill DESENLERİ instance adına BAĞLI ve `$` ile SONLANDIRILMIŞ olmalı. Geniş bir
# desen (`pkill -f "instance mi13"`) BAŞKA instance'ları da öldürür — bu oturumda
# yaşandı, 18 cihaz düştü. Her desen tek bir instance'ı hedefler.
set -u
WD_RUN=/opt/fleet-agent/waydroid/wd-run.sh
LOG=/var/log/mac-rollout.log
exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') MAC rollout BASLADI ==="

# Aktif hesaplı instance'lar (en sona bırakılır)
BUSY=$(docker exec fleet-postgres psql -U postgres -d fleet -t -A -c \
  "SELECT coalesce(d.metadata->>'instance','') FROM \"Device\" d
   JOIN \"GeneratedAccount\" g ON g.\"deviceId\"=d.id AND g.platform='whatsapp' AND g.status='ACTIVE'" \
  2>/dev/null | tr -d ' ')

ALL=""
for d in /var/lib/waydroid.*; do
  i="${d##*waydroid.}"
  [ "$i" = "work" ] && continue
  ALL="$ALL $i"
done

FREE=""; HELD=""
for i in $ALL; do
  if echo "$BUSY" | grep -qx "$i"; then HELD="$HELD $i"; else FREE="$FREE $i"; fi
done
echo "hesapsiz (once):$FREE"
echo "hesapli (sonra):$HELD"

restart_one() {
  i="$1"
  want=$(grep -m1 -oE '^lxc\.net\.0\.hwaddr[[:space:]]*=[[:space:]]*\S+' \
    "/var/lib/waydroid.$i/lxc/waydroid/config" 2>/dev/null | awk '{print $NF}')
  have=$(timeout 5 lxc-attach -n waydroid -P "/var/lib/waydroid.$i/lxc" -- \
    /system/bin/ip link show eth0 2>/dev/null | grep -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' | head -1)
  if [ -n "$want" ] && [ "$want" = "$have" ]; then
    echo "$(date '+%T') $i: MAC zaten guncel ($have) - ATLANDI"
    return 0
  fi
  echo "$(date '+%T') $i: $have -> $want yeniden baslatiliyor"
  pkill -9 -f "wd-run.sh $i\$" 2>/dev/null
  pkill -9 -f "wayland-$i\$" 2>/dev/null
  pkill -9 -f "xdg-$i\$" 2>/dev/null
  pkill -9 -f "waydroid.py --instance $i " 2>/dev/null
  pkill -9 -f "lxc-start.*waydroid\.$i\$" 2>/dev/null
  pkill -9 -f "dnsmasq.*waydroid-$i\$" 2>/dev/null
  lxc-stop -n waydroid -P "/var/lib/waydroid.$i/lxc" -k 2>/dev/null
  rm -rf "/run/xdg-$i" "/run/wd-$i" "/run/waydroid-$i-lxc" 2>/dev/null
  sleep 3
  setsid bash "$WD_RUN" "$i" >/dev/null 2>&1 </dev/null &
  ok=0
  n=0
  while [ "$n" -lt 30 ]; do
    n=$((n + 1))
    sleep 5
    ip=$(timeout 4 lxc-attach -n waydroid -P "/var/lib/waydroid.$i/lxc" -- \
      /system/bin/ip -4 addr show eth0 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}')
    [ -n "$ip" ] || continue
    adb connect "$ip:5555" >/dev/null 2>&1
    sleep 2
    if adb devices 2>/dev/null | grep -q "^$ip:5555[[:space:]]*device\$"; then
      newmac=$(timeout 5 adb -s "$ip:5555" shell 'cat /sys/class/net/eth0/address' 2>/dev/null | tr -d '\r\n')
      echo "$(date '+%T') $i: OK ONLINE ip=$ip mac=$newmac"
      ok=1
      break
    fi
  done
  [ "$ok" = 1 ] || echo "$(date '+%T') $i: BASARISIZ boot/ADB (health-watch devralacak)"
  sleep 5
}

for i in $FREE $HELD; do
  restart_one "$i"
done

echo "=== $(date '+%F %T') MAC rollout BITTI ==="
printf "ADB online: %s  offline: %s\n" \
  "$(adb devices 2>/dev/null | grep -c 'device$')" \
  "$(adb devices 2>/dev/null | grep -c offline)"
for s in $(adb devices 2>/dev/null | grep 'device$' | cut -f1); do
  timeout 4 adb -s "$s" shell 'cat /sys/class/net/eth0/address' 2>/dev/null | tr -d '\r\n'
  echo
done | sort -u | grep -c . | xargs -I{} echo "benzersiz MAC: {}"
