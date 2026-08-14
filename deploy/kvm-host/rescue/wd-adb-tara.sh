#!/bin/bash
# Periyodik ADB bakimi: bayat (offline) uclari onar + IP almis cihazlari bagla.
#
# ★★2026-08-15 v2 — iki gercek sorun duzeltildi:
#
#  1) `ps -eo stat` KULLANIYORDU. Bu komut /proc'taki TUM surecleri tarar ve
#     14 Agu'da sistemi UC KEZ kilitleyen sinifin ta kendisi (bkz. README).
#     Her 2 dakikada bir calisiyordu. -> /proc/stat procs_blocked ile degistirildi.
#
#  2) KENDI derin taramasini calistiriyordu (`wd-saglik.sh`), oysa wd-izle de
#     ayni taramayi ayni araliklarla yapip AYNI dosyaya yaziyordu:
#       - pahali is (40 paralel lxc-attach) IKI KEZ yapiliyordu
#       - iki surec ayni `saglik.out` dosyasina yaziyordu -> YARIS: biri okurken
#         digeri dosyayi sifirlayabiliyordu
#     -> Artik wd-izle'nin uretimi PAYLASILIYOR; yalnizca veri bayatsa (>5 dk)
#        kendi taramasini yapar.
L=/var/log/wd-adb-tara.log
LIST=/opt/fleet-agent/state/all_inst.txt
S=/opt/fleet-agent/state/saglik.out
S_MINE=/opt/fleet-agent/state/saglik-tara.out   # kendi taramasi (yaris olmasin)

dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0; }
sd_ms(){
  local s e rc
  s=$(date +%s%N); timeout 6 systemctl is-system-running >/dev/null 2>&1; rc=$?
  e=$(date +%s%N)
  [ "$rc" -eq 124 ] && { echo 9999; return; }
  echo $(( (e - s) / 1000000 ))
}
# Dosya kac saniye once yazildi (yoksa cok buyuk deger)
yas(){ [ -r "$1" ] && echo $(( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || echo 0) )) || echo 999999; }

while true; do
  D=$(dblocked)
  SD=$(sd_ms)

  # ── 1) Bayat (offline) uclari onar ────────────────────────────────────────
  # Cihaz yeniden baslayinca ADB ucu "offline" kalir ve disconnect+connect
  # olmadan ASLA kendine gelmez. Bu betigin ASIL degeri budur; ucuzdur, her
  # turda yapilir.
  OFF=$(timeout 8 adb devices 2>/dev/null | grep -c "offline$")
  if [ "${OFF:-0}" -gt 0 ]; then
    timeout 8 adb devices 2>/dev/null | grep "offline$" | cut -f1 \
      | xargs -P 20 -I{} sh -c 'adb disconnect {} >/dev/null 2>&1; sleep 1; timeout 8 adb connect {} >/dev/null 2>&1'
    echo "$(date +%H:%M:%S) bayat-uc onarimi: $OFF adet" >> "$L"
  fi

  # ── 2) Saglik verisi: PAYLASILAN dosyayi kullan ───────────────────────────
  KAYNAK="$S"
  if [ "$(yas "$S")" -gt 300 ]; then
    # wd-izle uretmiyor (durmus/atliyor olabilir). Kendi taramamizi yapalim --
    # ama SISTEM SAGLIKLIYSA. Izleme asla yuk kaynagi olmamali (14 Agu dersi).
    if [ "${SD:-0}" -le 3000 ] && [ "${D:-0}" -le 35 ]; then
      timeout 240 /opt/fleet-agent/wd-saglik.sh > "$S_MINE" 2>/dev/null && KAYNAK="$S_MINE"
      echo "$(date +%H:%M:%S) paylasilan veri bayat — kendi taramam yapildi" >> "$L"
    else
      echo "$(date +%H:%M:%S) veri bayat AMA sistem zorlaniyor (sd=${SD}ms D=$D) — tarama ATLANDI" >> "$L"
      KAYNAK=""
    fi
  fi

  # ── 3) IP almis ama bagli olmayan cihazlari bagla ─────────────────────────
  if [ -n "$KAYNAK" ] && [ -r "$KAYNAK" ]; then
    grep -E "\|192\.168\.|\|10\.10\." "$KAYNAK" 2>/dev/null | cut -d"|" -f2 \
      | xargs -P 30 -I{} timeout 8 adb connect {}:5555 >/dev/null 2>&1
    IP=$(grep -cE "\|192\.168\.|\|10\.10\." "$KAYNAK" 2>/dev/null)
    NET=$(cut -d'|' -f6 "$KAYNAK" 2>/dev/null | grep -cE '^[0-9]+\.')
  else
    IP='?'; NET='?'
  fi

  A=$(timeout 8 adb devices 2>/dev/null | grep -c "device$")
  O=$(timeout 8 adb devices 2>/dev/null | grep -c "offline$")
  TOP=$(wc -l < "$LIST" 2>/dev/null)
  echo "$(date +%H:%M:%S) ip=$IP adb=$A offline=$O internet=$NET D=$(dblocked) sd=${SD}ms kaynak=$(basename "${KAYNAK:-yok}")" >> "$L"

  # Log sismesin
  if [ "$(wc -l < "$L" 2>/dev/null)" -gt 4000 ]; then
    tail -2000 "$L" > "$L.tmp" && mv "$L.tmp" "$L"
  fi

  sleep 120
done
