#!/bin/bash
# 2026-08-14 TAKILAN KAPILARI COZ.
# Durum: boot-gate v5b (load'suz) kuruldu AMA halihazirda calisan gate surecleri
# ESKI kodu (load<=110 sarti) bellekte tutuyor. load bu hostta 114 civari takiliyor
# -> 33 cihaz bosuna bekliyor (D=0, systemd 11ms, sistem TAMAMEN saglikli).
# Cozum: bu unitleri restart et -> yeni gate kodu yuklenir -> D=0 oldugu icin
#        aninda gecer. 3 cihazla test edildi: 88->123 acik, systemd 11ms, D=0.
# Guvenlik: her cihazdan once SYSTEMD YANIT SURESI olculur (asil sinyal).
L=/var/log/wd-cozul.log
say(){ echo "$(date +%H:%M:%S) $*" >> "$L"; }
dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0; }
sd_ms(){
  local s e rc
  s=$(date +%s%N); timeout 8 systemctl is-system-running >/dev/null 2>&1; rc=$?
  e=$(date +%s%N)
  [ "$rc" -eq 124 ] && { echo 9999; return; }
  echo $(( (e - s) / 1000000 ))
}

say "=== COZULME BASLADI ==="
tur=0
while [ "$tur" -lt 12 ]; do
  tur=$((tur+1))
  LISTE=$(timeout 10 systemctl list-units --all --state=activating "waydroid@*" 2>/dev/null \
          | grep -oE 'waydroid@[a-z0-9]+' | sed 's/waydroid@//')
  N=$(echo "$LISTE" | grep -c .)
  [ "$N" -eq 0 ] && { say "kuyruk BOS - bitti"; break; }
  say "tur $tur: $N cihaz takili"

  for inst in $LISTE; do
    [ -z "$inst" ] && continue
    # KAPI: systemd saglikli mi
    b=0
    while :; do
      MS=$(sd_ms); D=$(dblocked)
      [ "$MS" -le 5000 ] && [ "${D:-0}" -le 45 ] && break
      b=$((b+1))
      [ "$b" -ge 40 ] && { say "!!! systemd 10dk toparlamadi (${MS}ms D=$D) -> DUR"; exit 1; }
      sleep 15
    done
    timeout 10 systemctl restart "waydroid@$inst" --no-block 2>/dev/null
    sleep 8
  done

  sleep 45
  A=$(timeout 10 systemctl list-units --state=running "waydroid@*" 2>/dev/null | grep -c waydroid@)
  say "tur $tur bitti: acik=$A/156 D=$(dblocked) systemd=$(sd_ms)ms"
done

A=$(timeout 10 systemctl list-units --state=running "waydroid@*" 2>/dev/null | grep -c waydroid@)
say "=== BITTI: acik=$A/156 adb=$(timeout 10 adb devices 2>/dev/null | grep -c 'device$') ==="
