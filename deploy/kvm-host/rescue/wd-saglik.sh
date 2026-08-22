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
  # ★★★2026-08-22 TEK DENEME YETMIYOR — SAHTE "CIKISI YOK" URETIYORDU.
  # 142 cihaz `xargs -P 40` ile AYNI ANDA taraniyor; residential/mobil proxy el
  # sikismasi + TLS bu yukte 12 sn'yi asabiliyor. Tek zaman asimi cihazi dogrudan
  # "cikisi yok" gosteriyordu ve /durum "N cihaz disari cikamiyor" ALARMI veriyordu.
  # CANLI KANIT: panel sirayla mi407, sonra mi396+mi401, sonra mi363+mi401 sucladi —
  # HER TURDA FARKLI cihaz (kalici arizanin degil, zaman asiminin imzasi). Ayni
  # cihazlar saniyeler sonra DOGRUDAN test edilince calisiyordu:
  #   mi363 -> 176.234.134.54 · mi401 -> 31.155.244.251 · mi396 -> 78.167.121.22
  # Maliyet yalnizca BASARISIZ olanlar icin odenir; saglam cihazlar icin 0.
  # ⚠️`tr -d` KORUNMALI: curl ciktisinda CR olursa "$" capasi tutmaz ve yine sahte
  #   "cikisi yok" uretilir. Regex ayrica IPv4 bicimine daraltildi (once "[0-9.]+" idi).
  cik=$(timeout 15 lxc-attach -P "$P" -n waydroid -- /system/bin/curl -s --max-time 12 https://api.ipify.org 2>/dev/null | tr -d "\r\n" | grep -oE "^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$")
  if [ -z "$cik" ]; then
    sleep 1
    cik=$(timeout 20 lxc-attach -P "$P" -n waydroid -- /system/bin/curl -s --max-time 17 https://api.ipify.org 2>/dev/null | tr -d "\r\n" | grep -oE "^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$")
  fi
  echo "$inst|$ip|${boot:-0}|$adb|${dns:--}|${cik:--}"
}
export -f tek
cat /opt/fleet-agent/state/all_inst.txt | xargs -P 40 -I{} bash -c "tek {}" 2>/dev/null | sort
