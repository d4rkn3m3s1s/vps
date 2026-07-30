#!/bin/bash
# wd-run.sh <instance> — phoenixNAP: çözülen 8-adım setsid multi-instance boot.
# Agent hostShDetached ile çağırır (fire-and-forget). Boot sonrası ADB tcp açar.
INST="${1:?instance}"
exec >> /var/log/wd-$INST-run.log 2>&1
set -x
XRD=/run/xdg-$INST
MI=/opt/waydroid-mi2
LXCP=/var/lib/waydroid.$INST/lxc
export PYTHONPATH=$MI
SUBNET=$(sh /opt/fleet-agent/waydroid/net-head.sh $INST)

# 1 temizle
pkill -9 -f "wayland-$INST" 2>/dev/null; pkill -9 -f "instance $INST" 2>/dev/null
rm -rf /run/wd-$INST /run/xdg-$INST 2>/dev/null; sleep 1
# netfix: stale network_up marker bridge yeniden kurulmasini engeller (KOK NEDEN)
rm -f /run/waydroid-$INST-lxc/network_up 2>/dev/null  # netfix
pkill -9 -f "dnsmasq.*waydroid-$INST" 2>/dev/null  # netfix orphan-dnsmasq (subnet cakismasi onler)
touch /var/lib/waydroid-subnets.map 2>/dev/null; chmod 666 /var/lib/waydroid-subnets.map 2>/dev/null  # netfix
# LEASE-TOHUMLAMA (.112 GARANTI) 2026-07-28: sistem her yerde 192.168.<sub>.112 varsayar
# ama dnsmasq .113 verebilir (CANLI: mi12/13/14/19). dnsmasq acilista mevcut lease'i
# onurlandirir -> lease BOS/YOK ise .112'yi onceden yaz. Dolu lease'e DOKUNMA.
_SUB=$(sh /opt/fleet-agent/waydroid/net-head.sh "$INST" 2>/dev/null)
_LEASE=/var/lib/misc/dnsmasq.waydroid-$INST.leases
# 2026-07-30 MAC-AWARE LEASE. Eskiden burada SABIT bir MAC (00:16:3e:f9:d3:03)
# tohumlaniyordu. Artik her instance'in KENDI MAC'i var (wd-mac-unique.sh) ve lease
# MAC'e KILITLI oldugu icin sabit MAC ile tohumlamak .112'yi YANLIS MAC'e baglar:
# yeni MAC lease'i bulamaz, dnsmasq havuzdan RASTGELE adres verir (CANLI: mi27 .50,
# mi46 .183, mi13 .9) ve sistemin her yerinde varsayilan olan .112 kirilir.
# Bu yuzden lease config'deki GERCEK MAC ile yazilir. Dolu lease'de de MAC uyusmuyorsa
# tazelenir (eski davranis 'dolu lease'e dokunma' idi -- ama icinde ESKI MAC varsa
# o lease zaten ise yaramaz durumdadir).
_CFGMAC=$(grep -m1 -oE '^lxc\.net\.0\.hwaddr[[:space:]]*=[[:space:]]*\S+' \
  "/var/lib/waydroid.$INST/lxc/waydroid/config" 2>/dev/null | awk '{print $NF}')
[ -n "$_CFGMAC" ] || _CFGMAC="00:16:3e:f9:d3:03"
if [ -n "$_SUB" ]; then
  mkdir -p /var/lib/misc 2>/dev/null
  # .112 satirini KIM tutuyor? Config MAC'i degilse lease tazelenir.
  _OWNER=$(grep -E "192\.168\.$_SUB\.112 " "$_LEASE" 2>/dev/null | awk '{print $2}' | head -1)
  if [ ! -s "$_LEASE" ] || [ "$_OWNER" != "$_CFGMAC" ]; then
    echo "4102444800 $_CFGMAC 192.168.$_SUB.112 Pixel-8-Pro 01:$_CFGMAC" > "$_LEASE"
  fi
fi
# 2 hazırla
mkdir -p $XRD/pulse; chmod 700 $XRD; : > $XRD/pulse/native
# 3 binder
bash /opt/fleet-agent/waydroid/wd-binder.sh $INST
# 4 weston
setsid env XDG_RUNTIME_DIR=$XRD weston --backend=headless --socket=wayland-$INST --width=1080 --height=2400 >/var/log/weston-$INST.log 2>&1 < /dev/null &
for i in $(seq 1 20); do [ -S $XRD/wayland-$INST ] && break; sleep 0.5; done
# 5 container
setsid env XDG_RUNTIME_DIR=$XRD PYTHONPATH=$MI python3 $MI/waydroid.py --instance $INST container start >/var/log/$INST-ct.log 2>&1 < /dev/null &
for i in $(seq 1 25); do dbus-send --system --dest=org.freedesktop.DBus --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -q "id.waydro.Container.$INST" && break; sleep 1; done
# 6 session bus
[ -S $XRD/bus ] || { setsid dbus-daemon --session --address=unix:path=$XRD/bus --nofork --nopidfile >/var/log/$INST-sbus.log 2>&1 < /dev/null & sleep 2; }
# 7 session start
setsid env XDG_RUNTIME_DIR=$XRD WAYLAND_DISPLAY=wayland-$INST DBUS_SESSION_BUS_ADDRESS=unix:path=$XRD/bus PYTHONPATH=$MI python3 $MI/waydroid.py --instance $INST session start >/var/log/$INST-sess.log 2>&1 < /dev/null &
# 8 boot bekle + ekran + ADB tcp
for i in $(seq 1 30); do
  st=$(lxc-info -n waydroid -P $LXCP -sH 2>/dev/null)
  [ "$st" = "FROZEN" ] && lxc-unfreeze -n waydroid -P $LXCP 2>/dev/null
  if [ "$st" = "RUNNING" ]; then
    bc=$(timeout 5 lxc-attach -n waydroid -P $LXCP -- getprop sys.boot_completed 2>/dev/null | tr -d "\r" | head -1)
    [ "$bc" = "1" ] && break
  fi
  sleep 3
done
# ekran sabitle + ADB tcp aç (agent 192.168.SUBNET.112:5555 e bağlanacak)
timeout 8 lxc-attach -n waydroid -P $LXCP -- wm size 1080x2400 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- wm density 421 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- setprop service.adb.tcp.port 5555 2>/dev/null
bash /opt/fleet-agent/waydroid/wd-adb.sh $INST
# ── wd-run netfix RETRY: boot-sonrasi ETH0 IP+ROUTE (netd'nin silmesine dayanikli) ──
# Android netd boot-completed sonrasi eth0'i BIR SURE daha yonetir + eklenen IPv4'u
# siler (canli: wd-run IP ekledi 14:44, netd sildi, heal 14:49 tekrar ekledi). COZUM:
# IP+route ekle, DOGRULA; IPv4 tutmadiysa 5s bekle tekrar dene (netd sakinlesene kadar,
# max 8 tur ~40s). Boylece heal'e dusmeden, boot biter bitmez internet hazir olur.
GW="192.168.$SUBNET.1"; IP="192.168.$SUBNET.112"
netfix_try() {
  HASIP=$(timeout 8 lxc-attach -n waydroid -P $LXCP -- ip -4 addr show eth0 2>/dev/null | grep -c "inet ")
  if [ "${HASIP:-0}" = "0" ]; then
    timeout 8 lxc-attach -n waydroid -P $LXCP -- ip addr add $IP/24 dev eth0 2>/dev/null
    timeout 8 lxc-attach -n waydroid -P $LXCP -- ip link set eth0 up 2>/dev/null
  fi
  for T in main local_network eth0; do
    timeout 8 lxc-attach -n waydroid -P $LXCP -- ip route add default via $GW dev eth0 table $T 2>/dev/null
  done
  timeout 8 lxc-attach -n waydroid -P $LXCP -- ip route add default via $GW dev eth0 2>/dev/null
  for T in eth0 local_network; do
    timeout 8 lxc-attach -n waydroid -P $LXCP -- ip route add 192.168.$SUBNET.0/24 dev eth0 proto static scope link src $IP table $T 2>/dev/null
  done
}
NETOK=0
for k in $(seq 1 14); do
  netfix_try
  HASIP=$(timeout 8 lxc-attach -n waydroid -P $LXCP -- ip -4 addr show eth0 2>/dev/null | grep -c "inet ")
  HASRT=$(timeout 8 lxc-attach -n waydroid -P $LXCP -- ip route show table eth0 2>/dev/null | grep -c "^default")
  if [ "${HASIP:-0}" != "0" ] && [ "${HASRT:-0}" != "0" ]; then
    # 3s bekle + BIR KEZ DAHA dogrula (netd hemen sonra silmiyor mu)
    sleep 3
    HASIP2=$(timeout 8 lxc-attach -n waydroid -P $LXCP -- ip -4 addr show eth0 2>/dev/null | grep -c "inet ")
    HASRT2=$(timeout 8 lxc-attach -n waydroid -P $LXCP -- ip route show table eth0 2>/dev/null | grep -c "^default")
    [ "${HASIP2:-0}" != "0" ] && [ "${HASRT2:-0}" != "0" ] && { NETOK=1; break; }
  fi
  sleep 5
done
echo "NET_READY $INST ip=$IP gw=$GW ok=$NETOK tries=$k"
# ── wd-run: REDSOCKS GUVENCESI (proxy'yi de boot'ta garanti; heal'e birakma) ──
# redsocks-inst-<inst>.conf saklı ise (bu instance'a proxy atanmis): daemon calismiyorsa
# baslat. Boylece cihaz boot biter bitmez proxy-cikisli (datacenter-IP degil = ban-guvenli).
# mi29 canli: redsocks olu idi -> REDIRECT vardi ama daemon yoktu -> TCP 000. Bu blok cozer.
RSCONF="/etc/redsocks-inst-$INST.conf"
if [ -f "$RSCONF" ]; then
  if ! pgrep -f "redsocks -c $RSCONF" >/dev/null 2>&1; then
    redsocks -c "$RSCONF" >/dev/null 2>&1 && echo "REDSOCKS_STARTED $INST" || echo "REDSOCKS_FAIL $INST"
  else
    echo "REDSOCKS_OK $INST (zaten calisiyor)"
  fi
fi
timeout 8 lxc-attach -n waydroid -P $LXCP -- start adbd 2>/dev/null
echo "BOOT_DONE $INST subnet=$SUBNET boot=$(timeout 5 lxc-attach -n waydroid -P $LXCP -- getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
# session i canlı tut (agent detached bekliyor)
sleep infinity
