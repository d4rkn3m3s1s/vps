#!/bin/bash
# 2026-08-14 PARALEL saglik kontrolu (40 paralel).
# ★KRITIK: container ICINDEKI komutlar TAM YOL ile cagrilmali.
#   systemd ortaminda PATH container a aktariliyor ve /system/bin ICERMIYOR
#   -> "Failed to exec ip" (status 127) ve HER cihaz NOIP gorunuyordu.
# Dogru yol: lxc-attach -P /var/lib/waydroid.<inst>/lxc -n waydroid -- /system/bin/<cmd>
tek(){
  inst="$1"
  P="/var/lib/waydroid.$inst/lxc"
  [ -d "$P" ] || { echo "$inst|-|-|-|-|-"; return; }
  ip=$(timeout 8 lxc-attach -P "$P" -n waydroid -- /system/bin/ip -4 -o addr show eth0 2>/dev/null | grep -oE "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+" | head -1)
  [ -z "$ip" ] && { echo "$inst|NOIP|-|-|-|-"; return; }
  boot=$(timeout 6 lxc-attach -P "$P" -n waydroid -- /system/bin/getprop sys.boot_completed 2>/dev/null | tr -d "\r\n")
  adb=$(timeout 6 adb -s "$ip:5555" get-state 2>/dev/null | tr -d "\r\n")
  [ -z "$adb" ] && adb="yok"
  dns=$(timeout 8 lxc-attach -P "$P" -n waydroid -- /system/bin/getprop net.dns1 2>/dev/null | tr -d "\r\n")
  cik=$(timeout 15 lxc-attach -P "$P" -n waydroid -- /system/bin/curl -s --max-time 12 https://api.ipify.org 2>/dev/null | tr -d "\r\n" | grep -oE "^[0-9.]+$")
  echo "$inst|$ip|${boot:-0}|$adb|${dns:--}|${cik:--}"
}
export -f tek
cat /opt/fleet-agent/state/all_inst.txt | xargs -P 40 -I{} bash -c "tek {}" 2>/dev/null | sort
