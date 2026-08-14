#!/bin/bash
# 2026-08-14 v4 SUREKLI DURUM KAYDI - 20 saniyede bir.
#
# ★★★ v4'un sebebi: v3'te `ps -eo stat` kaldirilmisti AMA `top -bn1` KALMIŞTI.
#   `top -bn1` de /proc'un TAMAMINI tarar (bu hostta yuz binlerce thread).
#   Izleyici her 20 sn'de bunu calistirinca kendisi tikanma kaynagi oldu ve
#   22:57'de kayit tamamen durdu (sayfa bayatladi, kor kaldik).
#   FIX: CPU bosta orani /proc/stat SATIRINDAN iki olcumun farkiyla hesaplanir.
#        Tek kucuk dosya okumasi -- /proc taramasi YOK.
#
# KURAL: bu betikte /proc'u TARAYAN hicbir komut olmayacak
#        (ps -e, top, pgrep -f, lsof ... hepsi YASAK).
L=/var/log/wd-izle.log
DETAY=/opt/fleet-agent/state/detay.txt
S=/opt/fleet-agent/state/saglik.out
TUR=0

# Host'un KENDI cikis IP'si. Bir cihaz bu IP ile cikiyorsa proxy DEVREDE DEGIL
# (datacenter IP -> WhatsApp bani). Bir kez olculur; degisirse servis restart'inda
# tazelenir. Ulasilamazsa bos kalir ve sizinti sayimi 0 doner (yanlis alarm yerine
# sessizlik -- gercek deger health-watch tarafindan da ayrica denetleniyor).
DC_IP="$(timeout 10 curl -s https://api.ipify.org 2>/dev/null || echo '')"

dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0; }
sc(){ timeout 6 systemctl "$@" 2>/dev/null; }

# ★★2026-08-14: GERCEK calisan container sayisi.
# systemd'nin "running" sayimi YANILTICI: health-watch zombie cihazlari `wd-run.sh`
# ile DOGRUDAN yeniden baslatiyor (systemd uzerinden degil) -> unit "running"
# gorunmuyor ama container AYAKTA. Canli olcum: systemd=135, GERCEK=152, ADB=140.
# Operator "cihazlar dusuyor" diye panikledi; oysa filo buyuyordu.
# Yontem: bridge'in uye arayuzu VAR mi -> sadece /sys okumasi, /proc TARAMASI YOK.
gercek_acik(){
  local n=0 d
  for d in /sys/class/net/waydroid-*/brif; do
    [ -n "$(ls -A "$d" 2>/dev/null)" ] && n=$((n+1))
  done
  echo "$n"
}

# systemd yanit suresi (ms) -- ASIL sinyal. Tikaliysa 9999.
sd_ms(){
  local s e rc
  s=$(date +%s%N); timeout 6 systemctl is-system-running >/dev/null 2>&1; rc=$?
  e=$(date +%s%N)
  [ "$rc" -eq 124 ] && { echo 9999; return; }
  echo $(( (e - s) / 1000000 ))
}

# CPU bosta % -- /proc/stat farki (UCUZ, tarama yok)
cpu_idle(){
  local a b at bt ai bi
  a=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5; exit}' /proc/stat)
  sleep 1
  b=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8, $5; exit}' /proc/stat)
  at=${a% *}; ai=${a#* }; bt=${b% *}; bi=${b#* }
  local dt=$(( bt - at )) di=$(( bi - ai ))
  [ "$dt" -le 0 ] && { echo "?"; return; }
  echo $(( di * 100 / dt ))
}

while true; do
  TUR=$((TUR+1))
  T=$(date +%H:%M:%S)

  ACIK=$(gercek_acik)                                   # GERCEK container (bkz. yukarisi)
  SYSD=$(sc list-units --state=running "waydroid@*" | grep -c waydroid@); SYSD=${SYSD:-?}
  KUY=$(sc list-units --all --state=activating "waydroid@*" | grep -c waydroid@); KUY=${KUY:-?}
  D=$(dblocked)
  SD=$(sd_ms)
  LO=$(cut -d' ' -f1 /proc/loadavg)
  RAM=$(free -g | awk 'NR==2{print $7}')
  CPUID=$(cpu_idle)
  ADB=$(timeout 8 adb devices 2>/dev/null | grep -c "device$")
  OFF=$(timeout 8 adb devices 2>/dev/null | grep -c "offline$")
  AG=$(sc is-active fleet-agent); AG=${AG:-?}
  FR=$(sc is-active wd-fren); FR=${FR:-?}

  # ★2026-08-15: filo boyutu artik SABIT DEGIL -- instance listesinden okunur.
  # "156" sabiti yanlisti: /var/lib/waydroid.* altinda filoya ait OLMAYAN dizin
  # de vardi (`work`), panel 156 derken DB'de 155 cihaz vardi.
  TOP=$(wc -l < /opt/fleet-agent/state/all_inst.txt 2>/dev/null); TOP=${TOP:-0}
  echo "$T | acik=$ACIK/$TOP sysd=$SYSD kuyruk=$KUY | adb=${ADB:-0} off=${OFF:-0} | D=$D sd=${SD}ms load=$LO RAM=${RAM}G cpuidle=${CPUID} | agent=$AG fren=$FR" >> "$L"

  # Derin tarama: 2 dakikada bir (pahali -- 40 paralel lxc-attach + curl)
  #
  # ★★2026-08-15 SAGLIK KAPISI. 14 Agu'nun ana dersi: IZLEME KENDISI YUK KAYNAGI
  # OLMAMALI. O gun sistem uc kez kilitlendi ve ucunde de sebep, olcum komutlarinin
  # /proc'u taramasiydi; benim izleyicim de `top -bn1` ile ayni hatayi yapip
  # 22:57'de kayit tutmayi tamamen durdurdu (kor kaldik).
  # Artik sistem zorlanirken derin tarama ATLANIR: ucuz sayimlar (ust satirlar)
  # yazilmaya devam eder, boylece kayit HIC kesilmez -- sadece pahali kisim bekler.
  SKIP=0
  [ "${SD:-0}" -gt 3000 ] 2>/dev/null && SKIP=1     # systemd zorlaniyor
  [ "${D:-0}" -gt 35 ] 2>/dev/null && SKIP=1        # /proc/disk baskisi
  if [ $((TUR % 6)) -eq 1 ] && [ "$SKIP" -eq 1 ]; then
    echo "$T | derin-tarama ATLANDI (sd=${SD}ms D=$D) — sistem zorlaniyor" >> "$L"
  fi
  if [ $((TUR % 6)) -eq 1 ] && [ "$SKIP" -eq 0 ]; then
    timeout 240 /opt/fleet-agent/wd-saglik.sh > "$S.tmp" 2>/dev/null && mv "$S.tmp" "$S"
    { echo "ip=$(grep -cE '\|192\.168\.|\|10\.10\.' "$S" 2>/dev/null)"
      echo "noip=$(grep -c NOIP "$S" 2>/dev/null)"
      echo "boot=$(cut -d'|' -f3 "$S" 2>/dev/null | grep -c '^1$')"
      echo "adbok=$(cut -d'|' -f4 "$S" 2>/dev/null | grep -c '^device$')"
      echo "net=$(cut -d'|' -f6 "$S" 2>/dev/null | grep -cE '^[0-9]+\.')"
      echo "cikis=$(cut -d'|' -f6 "$S" 2>/dev/null | grep -E '^[0-9]+\.' | head -3 | tr '\n' ' ')"
      # ★2026-08-15 PROXY SIZINTISI: cihazin cikis IP'si HOST'un kendi IP'siyse
      # proxy devrede DEGIL -> WhatsApp'a datacenter IP'sinden gidiliyor -> BAN.
      # 14 Agu gecesi reboot sonrasi 47 cihaz boyle cikti ve PANELDE GORUNMEDI;
      # health-watch tespit ediyor ama o sirada durdurulmustu. Artik sayisi
      # burada, tek bakista gorunur.
      echo "sizinti=$(cut -d'|' -f6 "$S" 2>/dev/null | grep -c "^${DC_IP}$")"
      echo "dcip=${DC_IP}"
      echo "zaman=$T"; } > "$DETAY"
  fi

  if [ "$(wc -l < "$L" 2>/dev/null)" -gt 5000 ]; then
    tail -3000 "$L" > "$L.tmp" && mv "$L.tmp" "$L"
  fi

  sleep 20
done
