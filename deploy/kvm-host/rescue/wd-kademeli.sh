#!/bin/bash
# 2026-08-14 v4 KADEMELI ACILIS.
#
# ★★★ v4'un varlik sebebi: v3 sistemi UC KEZ kilitledi.
#   Kok sebep iki katmanliydi:
#   (a) Olcum: `ps -eo stat` her turda tum /proc'u tariyordu (bkz. wd-boot-gate).
#   (b) SINYAL EKSIGI: fren D-state ve RAM'e bakiyordu ama gercek darbogaz
#       SYSTEMD'nin kendi kuyruguydu. D=2 / CPU %85 BOSTA iken bile
#       systemctl yanit veremez hale geldi ve SSH girisi (PAM->systemd) kapandi.
#   FIX: her cihazdan once SYSTEMD YANIT SURESI olculur. 5 sn'yi asarsa
#        yeni cihaz acilmaz, sistem kendine gelene kadar beklenir.
LIST=/opt/fleet-agent/state/all_inst.txt
L=/var/log/wd-kademeli.log
say(){ echo "$(date +%H:%M:%S) $*" >> "$L"; }
dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0; }

# systemd yanit suresi (ms). Tikaliysa buyuk deger veya 9999 doner.
sd_ms(){
  local s e
  s=$(date +%s%N)
  timeout 8 systemctl is-system-running >/dev/null 2>&1
  local rc=$?
  e=$(date +%s%N)
  [ "$rc" -eq 124 ] && { echo 9999; return; }
  echo $(( (e - s) / 1000000 ))
}

touch /run/wd-nogate
say "=== v4 BASLADI ==="
n=0; atlanan=0

while read -r inst; do
  [ -z "$inst" ] && continue
  timeout 6 systemctl is-active --quiet "waydroid@$inst" 2>/dev/null && continue

  # --- KAPI 1: systemd saglikli mi (ASIL sinyal)
  bekle=0
  while :; do
    MS=$(sd_ms)
    D=$(dblocked)
    [ "$MS" -le 5000 ] && [ "${D:-0}" -le 45 ] && break
    bekle=$((bekle+1))
    [ $((bekle % 4)) -eq 1 ] && say "  bekliyor: systemd=${MS}ms D=$D"
    if [ "$bekle" -ge 60 ]; then
      say "!!! systemd 15 dk'dir toparlamadi (systemd=${MS}ms D=$D) -> DURDURULDU"
      rm -f /run/wd-nogate
      exit 1
    fi
    sleep 15
  done

  timeout 10 systemctl start "waydroid@$inst" --no-block 2>/dev/null || atlanan=$((atlanan+1))
  n=$((n+1))
  sleep 10   # v3'te 6sn idi; systemd'ye nefes payi

  if [ $((n % 10)) -eq 0 ]; then
    A=$(timeout 6 systemctl list-units --state=running "waydroid@*" 2>/dev/null | grep -c waydroid@)
    say "  tetik=$n acik=${A:-?} D=$(dblocked) systemd=$(sd_ms)ms RAM=$(free -g | awk 'NR==2{print $7}')GB"
  fi
done < "$LIST"

rm -f /run/wd-nogate
say "=== v4 BITTI: $n tetiklendi, atlanan=$atlanan ==="
