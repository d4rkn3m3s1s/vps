#!/bin/bash
# 2026-08-14 v4 FREN.
#
# ★★★ v4 DEGISIKLIGI: olcum artik `ps -eo stat` DEGIL, /proc/stat procs_blocked.
#   Eski olcum /proc altindaki tum surecleri tariyordu; frenin kendisi
#   (ve 76 es zamanli boot-gate kapisi) /proc'u kilitleyip systemd'yi
#   tikiyordu -> SSH acilmiyordu. Bkz. wd-boot-gate.sh basindaki not.
#
# OLCUM NOTLARI (bugun canli):
#  - load TEK BASINA yaniltici: load 248 iken CPU %84 BOSTA olculdu
#    (Waydroid'de uyuyan thread'ler load'a sayiliyor).
#  - D-state gercek sinyal: 93'e ciktiginda fren kesti, 12 sn'de 10'a dustu.
#  - Fren CALISAN CIHAZLARI KAPATMAZ; sadece acilis betiklerini + agent'i durdurur.
L=/var/log/wd-fren.log
say(){ echo "$(date +%H:%M:%S) $*" >> "$L"; }
dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0; }

FREN=0; ARD=0

while true; do
  D=$(dblocked); D=${D:-0}
  LO=$(awk '{printf "%d", $1}' /proc/loadavg)
  RAMF=$(free -g | awk 'NR==2{print $7}')

  SIS=0
  [ "$D" -ge 50 ] && SIS=1
  [ "$D" -ge 35 ] && [ "$LO" -ge 150 ] && SIS=1
  [ "${RAMF:-99}" -le 20 ] && SIS=1

  if [ "$SIS" -eq 1 ]; then ARD=$((ARD+1)); else ARD=0; fi

  if [ "$ARD" -ge 2 ] && [ "$FREN" -eq 0 ]; then
    say "!!! SISME: D=$D load=$LO RAM=${RAMF}GB -> FREN"
    # timeout: systemd tikaliysa fren de asili kalmasin
    timeout 10 systemctl stop wd-boot-toparla 2>/dev/null
    timeout 10 systemctl stop wd-kademeli 2>/dev/null
    timeout 10 systemctl stop wd-onar 2>/dev/null
    timeout 10 systemctl stop wd-adb-tara 2>/dev/null
    timeout 10 systemctl stop fleet-agent 2>/dev/null
    FREN=1
    say "    acilis betikleri + agent durduruldu (CIHAZLAR KAPATILMADI)"
  fi

  if [ "$ARD" -eq 0 ] && [ "$FREN" -eq 1 ]; then
    say "    normale dondu: D=$D load=$LO RAM=${RAMF}GB"
    FREN=0
  fi

  sleep 10
done
