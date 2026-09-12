#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# CANLI DURUM SAYFASI — http://125.253.73.45/durum
#
# 2026-08-14 v2  ilk sürüm (cihaz katmanı)
# 2026-09-12 v3  ★ İŞ + TESLİMAT + DONANIM + GÜVENLİK katmanları eklendi,
#                  tasarım sıfırdan yazıldı, Türkçe karakterler açıldı.
#
# ★TASARIM İLKESİ: bu sayfa arıza anında, panik içinde, telefondan açılır.
#   O yüzden: (a) en üstte TEK cümlelik karar, (b) kötü olan şey RENKLİ —
#   her şey yeşilse hiçbir şey göze batmamalı, (c) ham log en altta KAPALI.
#
# ★VERİ KAYNAKLARI (hiçbiri bu betiğin içinde ölçülmez, hepsi hazır okunur):
#   /var/log/wd-izle.log            20 sn'lik sayım turu
#   state/detay.txt                 2 dk'lık derin tarama
#   state/saglik.out                cihaz bazlı satırlar (pipe ayraçlı)
#   state/dbozet.txt                90 sn'lik DB özeti (wd-durum-db.service)
#   /var/lib/wd-health/recovery.log otonom kurtarma kayıtları
#   /var/log/wd-canary.log          günlük + haftalık eş zamanlı canary
#   /proc/pressure/*                PSI — D-state'ten hassas kilit sinyali
#
# ★NEDEN DB'YE HER TURDA GİDİLMEZ: bu döngü 10 sn'de bir döner. psql çağrısı
#   ~140 ms; her turda gitmek günde ~8600 gereksiz sorgu VE sayfayı DB'ye
#   bağımlı kılar — DB yavaşlarsa durum sayfası da donar, ki arıza anında tam
#   istemediğimiz şey budur. Ayrı servis 90 sn'de bir düz metne yazar.
# ══════════════════════════════════════════════════════════════════════════════

OUT=/opt/fleet-agent/state/durum.html
L=/var/log/wd-izle.log
DETAY=/opt/fleet-agent/state/detay.txt
S=/opt/fleet-agent/state/saglik.out
DBO=/opt/fleet-agent/state/dbozet.txt

esc(){ sed 's/&/\&amp;/g;s/</\&lt;/g;s/>/\&gt;/g'; }

while true; do
  # ════════════════════════════════════════════════════════════════════════
  # BÖLÜM 1 — CİHAZ KATMANI (20 sn'lik sayım turundan)
  # ════════════════════════════════════════════════════════════════════════
  SON=$(tail -1 "$L" 2>/dev/null)
  g(){ echo "$SON" | grep -oE "$1=[0-9.]+" | head -1 | cut -d= -f2; }
  ACIK=$(g acik); KUY=$(g kuyruk); ADB=$(g adb); OFF=$(g off)
  D=$(g D); LO=$(g load); RAM=$(g RAM); CPUID=$(g cpuidle)
  AG=$(echo "$SON" | grep -oE "agent=[a-z]+" | cut -d= -f2)
  FR=$(echo "$SON" | grep -oE "fren=[a-z]+" | cut -d= -f2)
  SONSAAT=$(echo "$SON" | cut -d' ' -f1)

  # ★Toplam SABİT DEĞİL. "155" bayat bir sabitti; filo büyüyüp küçüldükçe
  # yanlış payda üretiyordu. Gerçek referans: systemd'de ENABLED birim sayısı.
  TOP=$(echo "$SON" | grep -oE "acik=[0-9?]+/[0-9]+" | cut -d/ -f2)
  [ -z "$TOP" ] && TOP=$(wc -l < /opt/fleet-agent/state/all_inst.txt 2>/dev/null)
  if [ -z "$TOP" ] || [ "${TOP:-0}" -le 0 ] 2>/dev/null; then
    TOP=$(ls /etc/systemd/system/multi-user.target.wants/ 2>/dev/null | grep -c '^waydroid@')
  fi
  case "$TOP" in ''|*[!0-9]*) TOP=1 ;; esac
  [ "$TOP" -le 0 ] && TOP=1
  ACIK=${ACIK:-0}; D=${D:-0}; ADB=${ADB:-0}; KUY=${KUY:-0}; OFF=${OFF:-0}
  YUZDE=$(( ACIK * 100 / TOP ))

  # ★GERÇEK YÜK. Çıplak "load" YANILTICI (canlı: load 11.6 iken CPU %93 BOŞTA).
  # Waydroid'de her cihaz yüzlerce UYUYAN Android thread'i tutar; bunların anlık
  # uyanması load sayacını şişirir ama CPU'yu KULLANMAZ.
  CORES=$(nproc 2>/dev/null); CORES=${CORES:-80}
  YUK=$(awk -v l="${LO:-0}" -v c="$CORES" 'BEGIN{ if(c>0) printf "%d", 100*l/c; else print 0 }')
  CU=${CPUID:-100}

  # ── Derin tarama (2 dk)
  dg(){ grep "^$1=" "$DETAY" 2>/dev/null | cut -d= -f2-; }
  IP=$(dg ip); NOIP=$(dg noip); BOOT=$(dg boot); ADBOK=$(dg adbok)
  NET=$(dg net); CIKIS=$(dg cikis); DZAMAN=$(dg zaman)
  SIZ=$(dg sizinti); SIZ=${SIZ:-?}; DCIP=$(dg dcip)
  PAYMAX=$(dg paylasim_max);   PAYMAX=${PAYMAX:-0}
  PAYKUME=$(dg paylasim_kume); PAYKUME=${PAYKUME:-0}
  PAYCIH=$(dg paylasim_cihaz); PAYCIH=${PAYCIH:-0}
  PAYLST=$(dg paylasim_liste)
  case "$PAYMAX" in ''|*[!0-9]*) PAYMAX=0 ;; esac

  ARTIK=$(wc -l < /opt/fleet-agent/state/artik_inst.txt 2>/dev/null); ARTIK=${ARTIK:-0}
  UPS=$(cut -d. -f1 /proc/uptime 2>/dev/null); case "$UPS" in ''|*[!0-9]*) UPS=0 ;; esac
  if   [ "$UPS" -ge 86400 ]; then UPTXT="$((UPS/86400))g $(((UPS%86400)/3600))sa"
  elif [ "$UPS" -ge 3600 ];  then UPTXT="$((UPS/3600))sa $(((UPS%3600)/60))dk"
  else                            UPTXT="$((UPS/60))dk"; fi
  DISK=$(df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}'); DISK=${DISK:-0}
  case "$DISK" in ''|*[!0-9]*) DISK=0 ;; esac
  DISKBOS=$(df -Ph / 2>/dev/null | awk 'NR==2{print $4}')
  RAMTOP=$(free -g 2>/dev/null | awk 'NR==2{print $2}')

  # ★ÇIKIŞI YOK: ADB'ye cevap veriyor ama dışarı çıkamıyor. mi277+mi290 tam bu
  # durumdaydı; panel onları "açık" sayıyordu ama WhatsApp'ları ÇALIŞMIYORDU.
  CIKSIZ=$(awk -F'|' '$4=="device" && ($6=="-" || $6=="") {printf "%s ", $1}' "$S" 2>/dev/null)
  CIKSIZN=$(echo $CIKSIZ | wc -w); CIKSIZN=${CIKSIZN:-0}
  # ★YARIM AÇILMIŞ: adb cevap verir (adbd erken kalkar) ama boot bitmemiştir.
  BOOTSUZ=$(awk -F'|' '$4=="device" && $3!="1" {printf "%s ", $1}' "$S" 2>/dev/null)
  BOOTSUZN=$(echo $BOOTSUZ | wc -w); BOOTSUZN=${BOOTSUZN:-0}

  # ════════════════════════════════════════════════════════════════════════
  # BÖLÜM 2 — DB ÖZETİ (90 sn'de bir ayrı servis üretir)
  # ════════════════════════════════════════════════════════════════════════
  db(){ grep "^$1|" "$DBO" 2>/dev/null | head -1 | cut -d'|' -f2; }
  db2(){ grep "^$1|" "$DBO" 2>/dev/null | head -1 | cut -d'|' -f3; }
  db3(){ grep "^$1|" "$DBO" 2>/dev/null | head -1 | cut -d'|' -f4; }
  DBTS=$(grep '^olcum_ts=' "$DBO" 2>/dev/null | cut -d= -f2)
  DBSAAT=$(grep '^olcum_saat=' "$DBO" 2>/dev/null | cut -d= -f2)
  # ★BAYATLIK: dosya varsa ama 5 dk'dan eskiyse DEĞERLERİ GÖSTERME.
  # "0 başarısız" yazan BAYAT bir kart, hiç kart olmamasından TEHLİKELİDİR.
  DBYAS=999
  [ -n "$DBTS" ] && DBYAS=$(( ($(date +%s) - DBTS) / 60 ))
  if [ "$DBYAS" -le 5 ] 2>/dev/null; then DBOK=1; else DBOK=0; fi

  IS_OK=$(db is24);        IS_FAIL=$(db2 is24)
  GOND=$(db gonderim_med); GONP95=$(db gonderim_p95)
  KUYS=$(db kuyruk_med);   BEKL=$(db bekleyen)
  FAILCIH=$(db fail_cihaz); JFSEBEP=$(db jobfail_sebep)
  ISTIPLER=$(db is_tipler); SAATLIK=$(db saatlik)
  MOUT=$(db msg24);        MIN=$(db2 msg24)
  MSENT=$(db msg_out);     MDEL=$(db2 msg_out);   MFAIL=$(db3 msg_out)
  SENTYAS=$(db sent_yas);  MFSEBEP=$(db msgfail_sebep)
  HACT=$(db hesap);        HBAN=$(db2 hesap);     HKIS=$(db3 hesap)
  HFAIL=$(db hesap_diger); HOUT=$(db2 hesap_diger)
  BAN7=$(db ban7); BAN24=$(db ban24); KIS24=$(db kisit24); BANSERI=$(db ban_seri)
  ALRM24=$(db alarm24); ALRMONAY=$(db alarm_onaysiz)
  ALRMZ=$(db son_alarm_zaman); ALRMB=$(db son_alarm_baslik); ALRMSIK=$(db alarm_sik)
  DBCIH=$(db db_cihaz); DBONL=$(db db_online); DBBAYAT=$(db db_bayat)
  DBBOY=$(db db_boyut); DBENB=$(db db_enbuyuk); DBOLU=$(db db_olu)

  ISTOP=$(( ${IS_OK:-0} + ${IS_FAIL:-0} ))
  if [ "$ISTOP" -gt 0 ] 2>/dev/null; then ISORAN=$(( ${IS_OK:-0} * 100 / ISTOP )); else ISORAN=100; fi
  HTOP=$(( ${HACT:-0} + ${HBAN:-0} + ${HKIS:-0} ))
  if [ "$HTOP" -gt 0 ] 2>/dev/null; then HORAN=$(( ${HACT:-0} * 100 / HTOP )); else HORAN=0; fi

  # ════════════════════════════════════════════════════════════════════════
  # BÖLÜM 3 — DONANIM / ÇEKİRDEK (PSI, sıcaklık, kapasite)
  # ════════════════════════════════════════════════════════════════════════
  # ★PSI — D-state'ten DAHA HASSAS. D-state anlık sayımdır: tarama anında
  # kilitli süreç yoksa 0 görürsün. PSI "son 10 sn'de süreçlerin yüzde kaçı
  # beklemek ZORUNDA kaldı" der — kısa ama TEKRARLAYAN takılmaları yakalar.
  psi(){ awk -v k="$2" '$1==k{for(i=2;i<=NF;i++){split($i,a,"=");if(a[1]=="avg10")print a[2]}}' "/proc/pressure/$1" 2>/dev/null | head -1; }
  PSI_IO=$(psi io full);      PSI_IOS=$(psi io some)
  PSI_MEM=$(psi memory full); PSI_CPU=$(psi cpu some)
  PSI_IO=${PSI_IO:-0}; PSI_IOS=${PSI_IOS:-0}; PSI_MEM=${PSI_MEM:-0}; PSI_CPU=${PSI_CPU:-0}

  # ★Sıcaklık: ARM host. mlx5 (ağ kartı) 65-72°C tipik, apm_xgene (CPU) ~50°C,
  # NVMe ~31°C. 85°C üzeri throttle — performans SESSİZCE düşer.
  TMAX=0; TAD=""
  for _h in /sys/class/hwmon/hwmon*/; do
    _n=$(cat "$_h/name" 2>/dev/null)
    for _t in "$_h"temp*_input; do
      [ -e "$_t" ] || continue
      _v=$(cat "$_t" 2>/dev/null); case "$_v" in ''|*[!0-9]*) continue ;; esac
      _c=$((_v/1000)); [ "$_c" -gt "$TMAX" ] && { TMAX=$_c; TAD="$_n"; }
    done
  done

  # ★ÇEKİRDEK KİLİT İZLERİ. 3 Eyl'de Linux 6.8 tracefs/eventfs deadlock'u 13
  # konteyneri kilitledi ve procs_blocked HİÇ göstermedi. 1 Eyl'de path_mount
  # kilidi vardı. İkisi de D-state sayacına YANSIMIYORDU. Tek güvenilir iz dmesg.
  _dm=$(dmesg 2>/dev/null | tail -400)
  HUNG=$(printf '%s' "$_dm" | grep -ciE "hung_task|blocked for more than|INFO: task.*blocked"); HUNG=${HUNG:-0}
  OOPS=$(printf '%s' "$_dm" | grep -ciE "Oops|kernel BUG|general protection"); OOPS=${OOPS:-0}
  OOMK=$(printf '%s' "$_dm" | grep -ci "Out of memory: Killed"); OOMK=${OOMK:-0}
  KTOP=$((HUNG+OOPS+OOMK))
  BINDN=$(grep -c binder /proc/mounts 2>/dev/null); BINDN=${BINDN:-0}

  # ★KAPASİTE. İlk duvar RAM (~225-233 cihaz ölçüldü), subnet tavanı 492.
  MEMAV=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo 2>/dev/null); MEMAV=${MEMAV:-0}
  MEMUSED=$(free -m 2>/dev/null | awk 'NR==2{print $3}')
  if [ "$ACIK" -gt 0 ] 2>/dev/null; then
    PERDEV=$(( ${MEMUSED:-0} / ACIK )); [ "$PERDEV" -lt 1 ] && PERDEV=1
    SIGAR=$(( (MEMAV * 85 / 100) / PERDEV ))   # %15 emniyet payı
  else PERDEV=0; SIGAR=0; fi
  SWTOT=$(awk '/^SwapTotal:/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
  SWFREE=$(awk '/^SwapFree:/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
  if [ "${SWTOT:-0}" -gt 0 ] 2>/dev/null; then SWPCT=$(( (SWTOT - ${SWFREE:-0}) * 100 / SWTOT )); else SWPCT=0; fi

  # ════════════════════════════════════════════════════════════════════════
  # BÖLÜM 4 — DAYANIKLILIK (servis, yedek, canary, gözcü)
  # ════════════════════════════════════════════════════════════════════════
  # ★wd-health-watch Type=oneshot ve SÜREKLİ DÖNGÜDE: biter-başlar, bu yüzden
  # çoğu zaman "activating" görünür. Bunu ölü saymak KALICI YANLIŞ KIRMIZI üretir.
  svc(){ s=$(systemctl is-active "$1" 2>/dev/null); case "$s" in active|activating) echo "ok" ;; *) echo "$s" ;; esac; }
  S_API=$(svc fleet-api); S_PANEL=$(svc fleet-dashboard); S_AG=$(svc fleet-agent)
  S_GOZ=$(svc wd-health-watch); S_IZLE=$(svc wd-izle); S_DB=$(svc wd-durum-db)
  S_KOTU=0
  for _s in "$S_API" "$S_PANEL" "$S_AG" "$S_GOZ" "$S_IZLE" "$S_DB"; do
    [ "$_s" = "ok" ] || S_KOTU=$((S_KOTU+1))
  done
  DKR=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c '^fleet-'); DKR=${DKR:-0}
  FAILED_U=$(systemctl list-units --state=failed --no-legend --plain 2>/dev/null | wc -l)

  # ★Yedek "var" demek yetmez — KAÇ SAATLİK olduğu önemli. Timer bozulursa
  # yedek sessizce eskir ve felaket anında günlerce veri gider.
  yedekyas(){ _f=$(ls -t $1 2>/dev/null | head -1); [ -z "$_f" ] && { echo -1; return; }
              _t=$(stat -c %Y "$_f" 2>/dev/null); [ -z "$_t" ] && { echo -1; return; }
              echo $(( ($(date +%s) - _t) / 3600 )); }
  YDB=$(yedekyas '/opt/db-backups/*.gz');        YDBN=$(ls /opt/db-backups/*.gz 2>/dev/null | wc -l)
  YCIH=$(yedekyas '/opt/device-backups/*.tgz');  YCIHN=$(ls /opt/device-backups/*.tgz 2>/dev/null | wc -l)

  # ★Günlük canary: tek cihaz uçtan uca. 23-25 Ağu'de HER GÜN kırmızı yandı ve
  # bu, cihaz açmanın 3 GÜNDÜR bozuk olduğunun TEK erken uyarısıydı.
  CANLOG=/var/log/wd-canary.log
  CANLAST=$(grep -aE 'OK:|BASARISIZ' "$CANLOG" 2>/dev/null | grep -v 'es-zamanli' | tail -1)
  CANTIME=$(printf '%s' "$CANLAST" | grep -oE '^[0-9-]{10} [0-9:]{8}' | cut -c6-16)
  CANYAS=""
  _ct=$(printf '%s' "$CANLAST" | grep -oE '^[0-9-]{10} [0-9:]{8}')
  [ -n "$_ct" ] && { _cs=$(date -d "$_ct" +%s 2>/dev/null || echo 0); [ "$_cs" -gt 0 ] && CANYAS=$(( ($(date +%s) - _cs) / 3600 )); }
  case "$CANLAST" in
    *"OK:"*)     CANV="GEÇTİ";     CANN="kurulum + DNS + çıkış + WhatsApp + ülke doğrulandı" ;;
    *BASARISIZ*) CANV="BAŞARISIZ"; CANN="YENİ CİHAZ AÇILAMIYOR — acil bak" ;;
    *)           CANV="?";         CANN="canary kaydı okunamadı" ;;
  esac
  [ -n "$CANYAS" ] && [ "$CANYAS" -gt 26 ] 2>/dev/null && CANN="son tur ${CANYAS} saat önce — günlük tur ÇALIŞMIYOR olabilir"

  # ★Eş zamanlı canary (haftalık): iki cihazın AYNI ANDA kurulmasındaki yarış
  # hatalarını yakalar. 28 Tem'de iki kurulum birbirinin instance'ını yarım silmişti.
  CPLAST=$(grep -aE 'es-zamanli.*(OK:|BASARISIZ)' "$CANLOG" 2>/dev/null | tail -1)
  CPTIME=$(printf '%s' "$CPLAST" | grep -oE '^[0-9-]{10} [0-9:]{8}' | cut -c6-16)
  CPYAS=""
  _pt=$(printf '%s' "$CPLAST" | grep -oE '^[0-9-]{10} [0-9:]{8}')
  [ -n "$_pt" ] && { _ps=$(date -d "$_pt" +%s 2>/dev/null || echo 0); [ "$_ps" -gt 0 ] && CPYAS=$(( ($(date +%s) - _ps) / 3600 )); }
  case "$CPLAST" in
    *"OK:"*)     CPV="GEÇTİ";     CPN="iki cihaz eş zamanlı kuruldu" ;;
    *BASARISIZ*) CPV="BAŞARISIZ"; CPN="YARIŞ HATASI — eş zamanlı kurulum bozuk" ;;
    *)           CPV="—";         CPN="henüz çalışmadı (haftalık: Çarşamba)" ;;
  esac
  [ -n "$CPYAS" ] && [ "$CPYAS" -gt 192 ] 2>/dev/null && CPN="son tur $((CPYAS/24)) gün önce — haftalık tur çalışmıyor olabilir"

  # ★Gözcü 7-9 dk'da bir tam tur atar. Tur DURURSA cihazlar düşmeye başlar ve
  # kimse kurtarmaz — ama sayfa yine yeşil görünür (cihazlar o an ayakta).
  GZLOG=/var/log/wd-health-watch.log
  GZLAST=$(tail -1 "$GZLOG" 2>/dev/null)
  GZTIME=$(printf '%s' "$GZLAST" | grep -oE '^[0-9-]{10} [0-9:]{8}' | cut -c12-16)
  GZSAGLAM=$(printf '%s' "$GZLAST" | grep -oE '[0-9]+ sağlıklı' | grep -oE '^[0-9]+')
  GZYAS=999
  _gt=$(printf '%s' "$GZLAST" | grep -oE '^[0-9-]{10} [0-9:]{8}')
  [ -n "$_gt" ] && { _ge=$(date -d "$_gt" +%s 2>/dev/null || echo 0); [ "$_ge" -gt 0 ] && GZYAS=$(( ($(date +%s) - _ge) / 60 )); }

  # ★Otonom kurtarma: "düşen cihaz BEN MÜDAHALE ETMEDEN kaç dk'da kalkıyor?"
  RECLOG=/var/lib/wd-health/recovery.log
  RNOW=$(date +%s); RCUT=$((RNOW - 86400))
  RSTAT=$(awk -v c="$RCUT" '$1>=c && $3 ~ /^[0-9]+$/ {n++; s+=$3; a[n]=$3; if($3>mx)mx=$3}
    END{ if(n==0){print "0 0 0 0"; exit}
         for(i=1;i<n;i++)for(j=i+1;j<=n;j++)if(a[i]>a[j]){t=a[i];a[i]=a[j];a[j]=t}
         md=(n%2)?a[(n+1)/2]:int((a[n/2]+a[n/2+1])/2)
         printf "%d %d %d %d", n, s/n, md, mx }' "$RECLOG" 2>/dev/null || echo "0 0 0 0")
  RN=$(echo "$RSTAT" | awk '{print $1}');  RAVG=$(echo "$RSTAT" | awk '{print $2}')
  RMED=$(echo "$RSTAT" | awk '{print $3}'); RMAX=$(echo "$RSTAT" | awk '{print $4}')
  RREC=$(awk -v c="$RCUT" '$1>=c && $4=="reconnect"{n++}END{print n+0}' "$RECLOG" 2>/dev/null || echo 0)
  RZOM=$(awk -v c="$RCUT" '$1>=c && $4=="zombie-restart"{n++}END{print n+0}' "$RECLOG" 2>/dev/null || echo 0)
  RKEN=$(awk -v c="$RCUT" '$1>=c && $4=="kendiliginden"{n++}END{print n+0}' "$RECLOG" 2>/dev/null || echo 0)
  RAVGDK=$((RAVG / 60)); RMEDDK=$((RMED / 60)); RMAXDK=$((RMAX / 60))

  # ★MEZAR TAŞI FİLTRESİ: silinmiş cihazın down- damgası hiç temizlenmiyordu →
  # sayfa "şu an düşük: 15" diyordu ve 15'inin HEPSİ SİLİNMİŞ cihazdı.
  DOWNN=0; DOWNL=""
  for _df in /var/lib/wd-health/down-*; do
    [ -e "$_df" ] || continue
    _in=$(basename "$_df" | sed 's/^down-//')
    grep -qx "$_in" /opt/fleet-agent/state/all_inst.txt 2>/dev/null || continue
    _t0=$(cat "$_df" 2>/dev/null); case "$_t0" in ''|*[!0-9]*) continue ;; esac
    _dk=$(( (RNOW - _t0) / 60 )); DOWNN=$((DOWNN+1))
    DOWNL="$DOWNL<span class=\"chip warn\">$_in · ${_dk}dk</span>"
  done

  # ════════════════════════════════════════════════════════════════════════
  # BÖLÜM 5 — PROXY HAVUZU + GÜVENLİK
  # ════════════════════════════════════════════════════════════════════════
  # ★6 Eyl: 141/143 cihaz TEK proxy hesabına bağlıydı; o hesap düşünce filonun
  # tamamı çıkışsız kaldı. Tek hesaba bağımlılık SESSİZ bir tekil arıza noktası.
  PTR=$(grep -l "port = 9999" /etc/redsocks-inst-*.conf 2>/dev/null | wc -l)
  PAL=$(grep -l "port = 5555" /etc/redsocks-inst-*.conf 2>/dev/null | wc -l)
  PTOP=$((PTR + PAL))
  if [ "$PTOP" -gt 0 ]; then PTRPCT=$(( PTR * 100 / PTOP )); else PTRPCT=0; fi
  IPKUME=$(awk -F'|' '{print $6}' "$S" 2>/dev/null | grep -E '^[0-9]' | cut -d. -f1-2 | sort -u | wc -l)
  IPTOP=$(awk -F'|' '{print $6}' "$S" 2>/dev/null | grep -E '^[0-9]' | sort -u | wc -l)

  SSHFAIL=$(journalctl -u ssh --since "24 hours ago" --no-pager 2>/dev/null | grep -ci "failed password"); SSHFAIL=${SSHFAIL:-0}
  SSHIP=$(journalctl -u ssh --since "24 hours ago" --no-pager 2>/dev/null | grep -i "accepted" | grep -oE "from [0-9.]+" | sort -u | wc -l); SSHIP=${SSHIP:-0}
  UFWD=$(ufw status 2>/dev/null | head -1 | grep -c active)
  SIRIZ=$(stat -c %a /opt/fleet-agent/agent.env 2>/dev/null)
  JRNL=$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[MG]' | tail -1)
  VARLOG=$(du -sm /var/log 2>/dev/null | cut -f1)

  # ════════════════════════════════════════════════════════════════════════
  # BÖLÜM 6 — GENEL KARAR
  # ★Sıra ÖNEMLİ: en tehlikeli olan en üstte. Karar D-state'e göre verilir
  # (asıl kilit sinyali), ham load'a DEĞİL.
  # ════════════════════════════════════════════════════════════════════════
  if   [ "$D" -ge 50 ]; then OZS="kritik"; OZB="TEHLİKE"; OZT="Sistem şişiyor — fren devrede olmalı"
  elif [ "$KTOP" -gt 0 ]; then OZS="kritik"; OZB="ÇEKİRDEK UYARISI"; OZT="dmesg'de kilit/oops/OOM izi var (hung=$HUNG oops=$OOPS oom=$OOMK)"
  elif [ "$D" -ge 25 ]; then OZS="uyari"; OZB="DİKKAT"; OZT="I/O baskısı artıyor — izle"
  elif [ "${BOOTSUZN:-0}" -gt 0 ] 2>/dev/null; then OZS="kritik"; OZB="$BOOTSUZN CİHAZ YARIM AÇILMIŞ"; OZT="açık görünüyor ama WhatsApp çalışmaz"
  elif [ "${SIZ:-0}" -gt 0 ] 2>/dev/null; then OZS="kritik"; OZB="PROXY SIZINTISI"; OZT="cihazlar datacenter IP'siyle çıkıyor — ban riski"
  elif [ "$ACIK" -lt $(( TOP * 90 / 100 )) ]; then OZS="uyari"; OZB="BAZI CİHAZLAR DÜŞÜK"; OZT="$ACIK/$TOP açık"
  elif [ "${CIKSIZN:-0}" -gt 0 ] 2>/dev/null; then OZS="uyari"; OZB="$CIKSIZN CİHAZ ÇIKAMIYOR"; OZT="mesaj gönderemez"
  elif [ "${SIZ}" = "?" ] || [ -z "$DCIP" ]; then OZS="uyari"; OZB="SIZINTI DENETLENEMİYOR"; OZT="host çıkış IP'si ölçülemedi — \"0\" ≠ \"ölçemedim\""
  elif [ "${GZYAS:-0}" -gt 25 ] 2>/dev/null; then OZS="uyari"; OZB="GÖZCÜ GECİKTİ"; OZT="son tur ${GZYAS} dk önce — düşen cihaz kurtarılmayabilir"
  elif [ "$S_KOTU" -gt 0 ] || [ "${DKR:-0}" -lt 2 ]; then OZS="uyari"; OZB="SERVİS SORUNU"; OZT="$S_KOTU servis / container $DKR/2"
  elif [ "${FAILED_U:-0}" -gt 0 ] 2>/dev/null; then OZS="uyari"; OZB="HATALI BİRİM"; OZT="$FAILED_U systemd birimi failed durumda"
  else OZS="iyi"; OZB="SİSTEM SAĞLIKLI"; OZT="kilit yok · filo ayakta · sızıntı yok"; fi

  # ════════════════════════════════════════════════════════════════════════
  # HTML
  # ════════════════════════════════════════════════════════════════════════
  {
    cat <<'HEAD'
<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="10">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Filo Durumu</title><style>
/* ── Tasarım sistemi ─────────────────────────────────────────────────────
   Tek bir ölçek: 4px grid. Renk YALNIZCA anlam taşıdığında kullanılır —
   her kart renkliyse hiçbiri göze batmaz, arıza anında bu öldürücüdür. */
:root{
  --bg:#0b0c0f; --card:#15171c; --card2:#1b1e25; --line:#242832;
  --fg:#e9eaee; --fg2:#9ba1ae; --fg3:#6b7280;
  --ok:#34d399; --warn:#fbbf24; --bad:#f87171; --info:#60a5fa;
  --r:14px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);
  font:400 14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;padding:20px 16px 48px}
.wrap{max-width:1180px;margin:0 auto}

/* Başlık */
.top{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:18px}
h1{font-size:20px;font-weight:650;letter-spacing:-.01em}
.meta{color:var(--fg3);font-size:12.5px;font-variant-numeric:tabular-nums}

/* Karar şeridi — sayfanın tek büyük görsel öğesi */
.verdict{border-radius:var(--r);padding:18px 20px;margin-bottom:26px;
  display:flex;align-items:center;gap:16px;border:1px solid var(--line);background:var(--card)}
.verdict .dot{width:10px;height:10px;border-radius:99px;flex:0 0 auto;box-shadow:0 0 0 4px rgba(255,255,255,.04)}
.verdict .txt b{display:block;font-size:17px;font-weight:650;letter-spacing:-.01em;margin-bottom:3px}
.verdict .txt span{color:var(--fg2);font-size:13px}
.v-iyi{border-color:rgba(52,211,153,.28);background:linear-gradient(180deg,rgba(52,211,153,.07),transparent)}
.v-iyi .dot{background:var(--ok)} .v-iyi b{color:var(--ok)}
.v-uyari{border-color:rgba(251,191,36,.3);background:linear-gradient(180deg,rgba(251,191,36,.08),transparent)}
.v-uyari .dot{background:var(--warn)} .v-uyari b{color:var(--warn)}
.v-kritik{border-color:rgba(248,113,113,.35);background:linear-gradient(180deg,rgba(248,113,113,.1),transparent)}
.v-kritik .dot{background:var(--bad)} .v-kritik b{color:var(--bad)}

/* Bölüm başlığı */
h2{font-size:11.5px;font-weight:600;color:var(--fg3);text-transform:uppercase;
  letter-spacing:.09em;margin:30px 0 12px;display:flex;align-items:center;gap:10px}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
h2 .hint{text-transform:none;letter-spacing:0;font-weight:400;color:var(--fg3);font-size:11.5px}

/* Kart ızgarası — sabit minimum, taşma yok */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:14px 15px;min-height:104px;display:flex;flex-direction:column}
.card .lbl{font-size:11px;font-weight:500;color:var(--fg3);text-transform:uppercase;
  letter-spacing:.05em;line-height:1.35;min-height:15px}
.card .num{font-size:28px;font-weight:650;letter-spacing:-.02em;line-height:1.15;
  margin-top:7px;font-variant-numeric:tabular-nums}
.card .num.sm{font-size:19px;letter-spacing:-.01em}
.card .unit{font-size:13px;font-weight:500;color:var(--fg3);margin-left:2px}
.card .sub{font-size:11.5px;color:var(--fg3);line-height:1.5;margin-top:auto;padding-top:7px}
.ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)} .info{color:var(--info)} .dim{color:var(--fg3)}

/* İlerleme çubuğu */
.bar{height:5px;border-radius:99px;background:var(--line);overflow:hidden;margin-top:9px}
.bar>i{display:block;height:100%;border-radius:99px}

/* Geniş kart */
.wide{grid-column:1/-1;background:var(--card);border:1px solid var(--line);
  border-radius:var(--r);padding:14px 16px}
.wide.accent-warn{border-left:3px solid var(--warn)}
.wide.accent-bad{border-left:3px solid var(--bad)}
.wide.accent-ok{border-left:3px solid var(--ok)}
.wide .lbl{font-size:11px;font-weight:500;color:var(--fg3);text-transform:uppercase;letter-spacing:.05em}
.wide .body{margin-top:8px;font-size:13.5px;line-height:1.65}
.wide .sub{font-size:11.5px;color:var(--fg3);margin-top:7px;line-height:1.5}

/* Grafik */
.chart{display:flex;align-items:flex-end;gap:2px;height:74px;
  background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 12px 8px}
.chart.tall{height:96px}
.col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;min-width:0}
.col i{display:block;width:100%;border-radius:3px 3px 0 0}
.col em{font-style:normal;font-size:9px;color:var(--fg3);font-variant-numeric:tabular-nums}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}

/* Rozet */
.chip{display:inline-block;margin:3px 6px 3px 0;padding:3px 10px;border-radius:99px;
  background:var(--card2);border:1px solid var(--line);font-size:12px;font-variant-numeric:tabular-nums}
.chip.warn{color:var(--warn);border-color:rgba(251,191,36,.25)}
.chip.ok{color:var(--ok);border-color:rgba(52,211,153,.25)}

/* Katlanabilir ham veri — varsayılan KAPALI, sayfayı boğmasın */
details{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-top:10px}
summary{padding:12px 16px;cursor:pointer;font-size:12.5px;color:var(--fg2);
  list-style:none;display:flex;align-items:center;gap:8px;user-select:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸";color:var(--fg3);font-size:11px;transition:transform .15s}
details[open] summary::before{transform:rotate(90deg)}
details pre{margin:0;padding:0 16px 14px;overflow-x:auto;font-size:11.5px;line-height:1.7;
  color:var(--fg2);font-family:ui-monospace,"SF Mono",Menlo,monospace}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}

@media(max-width:760px){
  body{padding:14px 11px 36px}
  .grid{grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:8px}
  .card{min-height:94px;padding:12px 13px}
  .card .num{font-size:24px}
  .two{grid-template-columns:1fr}
  .verdict{padding:15px 16px}
}
</style></head><body><div class="wrap">
HEAD

    # ── Başlık
    echo "<div class=\"top\"><h1>Filo Durumu</h1><div class=\"meta\">10 sn'de bir yenilenir · sayım ${SONSAAT:-?} · derin tarama ${DZAMAN:-bekleniyor} · DB özeti ${DBSAAT:-?}</div></div>"

    # ── Karar şeridi
    echo "<div class=\"verdict v-${OZS}\"><div class=\"dot\"></div><div class=\"txt\"><b>${OZB}</b><span>${OZT}</span></div></div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2>Filo <span class=\"hint\">20 saniyelik sayım turu</span></h2><div class=\"grid\">"
    if [ "$ACIK" -ge $(( TOP * 90 / 100 )) ]; then AC=ok; elif [ "$ACIK" -ge $(( TOP * 50 / 100 )) ]; then AC=warn; else AC=bad; fi
    ABC=$(case $AC in ok) echo "var(--ok)";; warn) echo "var(--warn)";; *) echo "var(--bad)";; esac)
    echo "<div class=\"card\"><div class=\"lbl\">Açık cihaz</div><div class=\"num $AC\">${ACIK}<span class=\"unit\">/${TOP}</span></div><div class=\"bar\"><i style=\"width:${YUZDE}%;background:${ABC}\"></i></div><div class=\"sub\">%${YUZDE} ayakta</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">ADB bağlı</div><div class=\"num\">${ADB}</div><div class=\"sub\">bayat uç: ${OFF}</div></div>"
    if [ "$D" -ge 50 ]; then DC=bad; DT="TEHLİKE"; elif [ "$D" -ge 25 ]; then DC=warn; DT="dikkat"; else DC=ok; DT="normal"; fi
    echo "<div class=\"card\"><div class=\"lbl\">D-state</div><div class=\"num $DC\">${D}</div><div class=\"sub\">${DT} · I/O bekleyen · fren eşiği 50</div></div>"
    if [ "${CU%%.*}" -ge 70 ] 2>/dev/null; then CC=ok; CT="rahat"; elif [ "${CU%%.*}" -ge 40 ] 2>/dev/null; then CC=warn; CT="orta"; else CC=bad; CT="yoğun"; fi
    echo "<div class=\"card\"><div class=\"lbl\">CPU boşta</div><div class=\"num $CC\">${CU%%.*}<span class=\"unit\">%</span></div><div class=\"sub\">doluluk ~%${YUK} · ${CT}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Ham load</div><div class=\"num sm dim\">${LO:-?}</div><div class=\"sub\">${CORES} çekirdek · <b>yanıltıcı</b>: Waydroid uyuyan thread'leri şişirir</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Kuyrukta</div><div class=\"num\">${KUY}</div><div class=\"sub\">açılmayı bekleyen cihaz</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Boş RAM</div><div class=\"num\">${RAM:-?}<span class=\"unit\">GB</span></div><div class=\"sub\">toplam ${RAMTOP:-?} GB</div></div>"
    if [ "$DISK" -ge 90 ]; then DKC=bad; elif [ "$DISK" -ge 75 ]; then DKC=warn; else DKC=ok; fi
    echo "<div class=\"card\"><div class=\"lbl\">Disk</div><div class=\"num $DKC\">${DISK}<span class=\"unit\">%</span></div><div class=\"sub\">kök bölüm · boş ${DISKBOS:-?}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Sunucu ayakta</div><div class=\"num sm\">${UPTXT:-?}</div><div class=\"sub\">son yeniden başlatmadan beri</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Artık dizin</div><div class=\"num sm dim\">${ARTIK}</div><div class=\"sub\">silinmiş cihazdan kalan · sayıma girmez</div></div>"
    echo "</div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2>Ağ ve proxy <span class=\"hint\">2 dakikalık derin tarama</span></h2><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">IP almış</div><div class=\"num\">${IP:-?}</div><div class=\"sub\">IP yok: ${NOIP:-?}</div></div>"
    if [ "${BOOTSUZN:-0}" -gt 0 ] 2>/dev/null; then BC=bad; BN="$BOOTSUZN cihaz YARIM AÇILMIŞ"; else BC=ok; BN="boot tamamlandı"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Android açık</div><div class=\"num $BC\">${BOOT:-?}</div><div class=\"sub\">${BN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">İnternet + proxy</div><div class=\"num ok\">${NET:-?}</div><div class=\"sub\">dışarı çıkabiliyor</div></div>"
    # ★"0" ≠ "ölçemedim". DC_IP boşken yeşil "sızıntı yok" göstermek, 47 cihazın
    # sızıntılı olduğu 14 Ağu gecesinin tekrarına davetiyedir.
    if [ "$SIZ" = "?" ] || [ -z "$DCIP" ]; then SC=warn; SN="ÖLÇÜLEMEDİ — host çıkış IP'si alınamadı"
    elif [ "${SIZ:-0}" -gt 0 ] 2>/dev/null; then SC=bad; SN="BAN RİSKİ — proxy devrede değil"
    else SC=ok; SN="proxy hepsinde devrede"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Proxy sızıntısı</div><div class=\"num $SC\">${SIZ}</div><div class=\"sub\">${SN}</div></div>"
    if [ "${CIKSIZN:-0}" -gt 0 ] 2>/dev/null; then CKC=warn; CKN="dışarı çıkamıyor — WhatsApp çalışmaz"; else CKC=ok; CKN="hepsi dışarı çıkabiliyor"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Çıkışı yok</div><div class=\"num $CKC\">${CIKSIZN:-0}</div><div class=\"sub\">${CKN}</div></div>"
    # ★Paylaşım kademeli: 2'li çakışma mobil havuzda NORMALDİR, alarm yapmak gürültü olur.
    if   [ "$PAYMAX" -ge 5 ]; then PC=bad;  PN="HAVUZ DARALDI — ${PAYMAX} cihaz aynı IP'de"
    elif [ "$PAYMAX" -ge 3 ]; then PC=warn; PN="${PAYKUME} kümede paylaşım — izle"
    elif [ "$PAYMAX" -ge 2 ]; then PC=ok;   PN="normal (mobil havuz çakışması)"
    else                          PC=ok;   PN="her cihaz kendi IP'sinde"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Paylaşılan çıkış</div><div class=\"num $PC\">${PAYMAX}<span class=\"unit\">/IP</span></div><div class=\"sub\">${PN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Çıkış IP çeşitliliği</div><div class=\"num sm\">${IPTOP:-?}</div><div class=\"sub\">benzersiz IP · ${IPKUME:-?} farklı /16 küme</div></div>"
    # ★6 Eyl: 141/143 tek hesaptaydı, o havuz düşünce filo çıkışsız kaldı.
    if   [ "$PTRPCT" -ge 95 ]; then HC=warn; HN="TEK HAVUZA BAĞIMLI — düşerse filo çıkışsız"
    elif [ "$PTRPCT" -ge 80 ]; then HC=warn; HN="ağırlık tek havuzda"
    else                           HC=ok;   HN="havuzlar dengeli"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Havuz dağılımı</div><div class=\"num sm $HC\">${PTR:-?}<span class=\"unit\">/${PAL:-?}</span></div><div class=\"sub\">TR mobil / AL residential · ${HN}</div></div>"
    echo "</div>"

    [ -n "$CIKIS" ] && echo "<div class=\"wide\" style=\"margin-top:10px\"><div class=\"lbl\">Proxy çıkış IP örnekleri</div><div class=\"body mono info\">$(echo "$CIKIS" | esc)</div><div class=\"sub\">TR residential olmalı · host IP <span class=\"mono\">${DCIP:-?}</span> — bu IP çıkarsa SIZINTI</div></div>"
    if [ -n "$PAYLST" ] && [ "${PAYMAX:-0}" -ge 2 ]; then
      echo "<div class=\"wide accent-${PC}\" style=\"margin-top:10px\"><div class=\"lbl\">Aynı çıkış IP'sini paylaşan cihazlar</div><div class=\"body mono\">$(echo "$PAYLST" | esc)</div><div class=\"sub\">${PAYCIH} cihaz · ${PAYKUME} küme · en büyük küme ${PAYMAX} · IP(kaç cihaz) biçiminde</div></div>"
    fi
    if [ -n "$BOOTSUZ$CIKSIZ" ]; then
      echo "<div class=\"wide accent-bad\" style=\"margin-top:10px\"><div class=\"lbl\">Dikkat isteyen cihazlar</div><div class=\"body\">"
      [ -n "$BOOTSUZ" ] && echo "<div><b class=\"bad\">Yarım açılmış (Android boot bitmedi):</b> <span class=\"mono\">$(echo "$BOOTSUZ" | esc)</span></div>"
      [ -n "$CIKSIZ" ]  && echo "<div><b class=\"warn\">Çıkışı yok (dışarı ulaşamıyor):</b> <span class=\"mono\">$(echo "$CIKSIZ" | esc)</span></div>"
      echo "</div></div>"
    fi

    # ══════════════════════════════════════════════════════════════════════
    # İŞ AKIŞI — DB katmanı
    # ══════════════════════════════════════════════════════════════════════
    if [ "$DBOK" != "1" ]; then
      echo "<h2>İş akışı</h2><div class=\"wide accent-warn\"><div class=\"lbl\">İş katmanı ölçülemiyor</div><div class=\"body warn\">DB özeti ${DBYAS} dk önce güncellendi — tazesi 90 sn'de bir gelmeli</div><div class=\"sub\">wd-durum-db.service çalışmıyor olabilir · aşağıdaki kartlar gösterilmiyor çünkü bayat veri, veri olmamasından tehlikelidir</div></div>"
    else
    echo "<h2>İş akışı <span class=\"hint\">son 24 saat · panel veritabanı</span></h2><div class=\"grid\">"
    if   [ "$ISORAN" -ge 95 ]; then IC=ok;   IN="normal işleyiş"
    elif [ "$ISORAN" -ge 85 ]; then IC=warn; IN="başarısızlık arttı"
    else                           IC=bad;  IN="CİDDİ — işler tutmuyor"; fi
    IBC=$(case $IC in ok) echo "var(--ok)";; warn) echo "var(--warn)";; *) echo "var(--bad)";; esac)
    echo "<div class=\"card\"><div class=\"lbl\">İş başarı oranı</div><div class=\"num $IC\">${ISORAN}<span class=\"unit\">%</span></div><div class=\"bar\"><i style=\"width:${ISORAN}%;background:${IBC}\"></i></div><div class=\"sub\">${IS_OK:-?} tamam · ${IS_FAIL:-?} başarısız · ${IN}</div></div>"
    case "${GOND:-?}" in
      ''|'?') GC=dim; GN="ölçülemedi" ;;
      *) if   [ "${GOND}" -le 20 ] 2>/dev/null; then GC=ok;   GN="hedefte (12-17 sn tipik)"
         elif [ "${GOND}" -le 35 ] 2>/dev/null; then GC=warn; GN="yavaşladı"
         else GC=bad; GN="ÇOK YAVAŞ"; fi ;;
    esac
    echo "<div class=\"card\"><div class=\"lbl\">Gönderim süresi</div><div class=\"num $GC\">${GOND:-?}<span class=\"unit\">sn</span></div><div class=\"sub\">medyan · p95 ${GONP95:-?} sn · ${GN}</div></div>"
    # ★Kuyruk AYRI ölçülür: "yavaş" şikâyetinin iki kökü var — cihaz mı yavaş,
    # yoksa iş kuyrukta mı bekliyor? Aynı karta koymak teşhisi körleştirir.
    case "${KUYS:-?}" in
      ''|'?') KC=dim; KN="ölçülemedi" ;;
      *) if   [ "${KUYS}" -le 5 ] 2>/dev/null;  then KC=ok;   KN="kuyruk akıyor"
         elif [ "${KUYS}" -le 30 ] 2>/dev/null; then KC=warn; KN="birikme başladı"
         else KC=bad; KN="KUYRUK TIKANDI"; fi ;;
    esac
    echo "<div class=\"card\"><div class=\"lbl\">Kuyruk beklemesi</div><div class=\"num $KC\">${KUYS:-?}<span class=\"unit\">sn</span></div><div class=\"sub\">iş oluşup başlayana kadar · ${KN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Şu an işleniyor</div><div class=\"num\">${BEKL:-?}</div><div class=\"sub\">PENDING + RUNNING</div></div>"
    # ★Bu ayrım teşhiste her şeyi değiştirir: başarısızlığın çoğu tek cihazdaysa
    # o cihaz arızalı; filoya dağılmışsa sistemik bir sorun var.
    if [ "${IS_FAIL:-0}" -gt 0 ] 2>/dev/null && [ "${FAILCIH:-0}" -gt 0 ] 2>/dev/null; then
      FPAY=$(( FAILCIH * 100 / IS_FAIL ))
      if [ "$FPAY" -ge 50 ]; then FN="çoğu TEK cihazda — o cihaza bak"; FC=warn
      else FN="filoya dağılmış — sistemik olabilir"; FC=warn; fi
    else FN="başarısız iş yok"; FC=ok; fi
    echo "<div class=\"card\"><div class=\"lbl\">Başarısızlık dağılımı</div><div class=\"num sm $FC\">${FAILCIH:-0}<span class=\"unit\">/${IS_FAIL:-0}</span></div><div class=\"sub\">${FN}</div></div>"
    echo "</div>"
    [ -n "$ISTIPLER" ] && echo "<div class=\"wide\" style=\"margin-top:10px\"><div class=\"lbl\">İş tipleri · tamam/başarısız</div><div class=\"body mono\">$(echo "$ISTIPLER" | esc)</div></div>"
    [ -n "$JFSEBEP" ] && [ "$JFSEBEP" != "-" ] && echo "<div class=\"wide accent-warn\" style=\"margin-top:10px\"><div class=\"lbl\">En sık iş hatası</div><div class=\"body\">$(echo "$JFSEBEP" | esc)</div></div>"

    # ── Saatlik grafik: yoğunluk ve başarısızlık AYNI saatte mi toplanıyor?
    if [ -n "$SAATLIK" ]; then
      SMAX=1
      for _p in $(echo "$SAATLIK" | tr ',' ' '); do
        _n=$(echo "$_p" | cut -d: -f2); [ "${_n:-0}" -gt "$SMAX" ] 2>/dev/null && SMAX=$_n
      done
      SBARS=""
      for _p in $(echo "$SAATLIK" | tr ',' ' '); do
        _h=$(echo "$_p" | cut -d: -f1); _n=$(echo "$_p" | cut -d: -f2); _f=$(echo "$_p" | cut -d: -f3)
        _hh=$(( ${_n:-0} * 62 / SMAX )); [ "$_hh" -lt 3 ] && _hh=3
        _c="var(--info)"
        [ "${_f:-0}" -gt 0 ] 2>/dev/null && [ "${_n:-1}" -gt 0 ] 2>/dev/null && \
          [ $(( _f * 100 / _n )) -ge 5 ] 2>/dev/null && _c="var(--bad)"
        SBARS="$SBARS<div class=\"col\" title=\"${_h}:00 · ${_n} iş · ${_f} başarısız\"><i style=\"background:${_c};height:${_hh}px\"></i><em>${_h}</em></div>"
      done
      echo "<h2>Saatlik iş yoğunluğu <span class=\"hint\">24 saat</span></h2><div class=\"chart tall\">$SBARS</div>"
      echo "<div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-top:7px\">mavi: normal · <span class=\"bad\">kırmızı</span>: o saatte başarısızlık %5'i geçti · en yoğun saat ${SMAX} iş</div>"
    fi

    # ══════════════════════════════════════════════════════════════════════
    # MESAJ TESLİMATI  ★İŞİN "COMPLETED" DÖNMESİ TESLİMAT DEMEK DEĞİL
    # ══════════════════════════════════════════════════════════════════════
    echo "<h2>Mesaj teslimatı <span class=\"hint\">son 24 saat</span></h2><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">Giden / gelen</div><div class=\"num sm\">${MOUT:-?}<span class=\"unit\"> / ${MIN:-?}</span></div><div class=\"sub\">OUT / IN mesaj</div></div>"
    # ★ÖLÇÜLEN GERÇEK: statusAt hiç güncellenmiyor, OUT mesajların neredeyse
    # tamamı SENT'te donuyor. "SENT" burada "gönderildi" DEĞİL, "teslim onayı
    # hiç işlenmedi" demek. Bunu gizlemek 24 Ağu körlüğünü tekrar üretir.
    if [ "${MDEL:-0}" -gt 0 ] 2>/dev/null; then TC=ok; TN="teslim onayı geliyor"
    else TC=warn; TN="teslim onayı İŞLENMİYOR"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Teslim onayı</div><div class=\"num $TC\">${MDEL:-0}<span class=\"unit\">/${MOUT:-0}</span></div><div class=\"sub\">${TN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Onay bekleyen</div><div class=\"num warn\">${MSENT:-0}</div><div class=\"sub\">SENT durumunda · medyan yaş ${SENTYAS:-?} dk</div></div>"
    if [ "${MFAIL:-0}" -gt 0 ] 2>/dev/null; then FMC=warn; else FMC=ok; fi
    echo "<div class=\"card\"><div class=\"lbl\">Gönderilemeyen</div><div class=\"num $FMC\">${MFAIL:-0}</div><div class=\"sub\">FAILED işaretli</div></div>"
    echo "</div>"
    echo "<div class=\"wide accent-warn\" style=\"margin-top:10px\"><div class=\"lbl\">Teslimat izi hakkında</div><div class=\"body\">Giden mesajların durumu <span class=\"mono\">SENT</span>'te kalıyor: teslimat onayı (DELIVERED/READ) sisteme <b>işlenmiyor</b>. Yani <b>\"gönderildi\" ≠ \"ulaştı\"</b> — iş <span class=\"mono\">COMPLETED</span> dönse bile mesajın karşıya ulaştığı <u>doğrulanmış değil</u>.</div><div class=\"sub\">En sık gönderim hatası: $(echo "${MFSEBEP:--}" | esc)</div></div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2>WhatsApp hesapları</h2><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">Aktif hesap</div><div class=\"num ok\">${HACT:-?}</div><div class=\"bar\"><i style=\"width:${HORAN}%;background:var(--ok)\"></i></div><div class=\"sub\">kullanılabilir oran %${HORAN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Banlı</div><div class=\"num bad\">${HBAN:-?}</div><div class=\"sub\">kalıcı kayıp</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Kısıtlı</div><div class=\"num warn\">${HKIS:-?}</div><div class=\"sub\">yeni sohbet açamaz</div></div>"
    # ★4 Ağu'de hesapların %39'u BİR GECEDE yandı; tek erken sinyal "son 24
    # saatte kaç ban" idi ve hiçbir yerde görünmüyordu.
    if   [ "${BAN24:-0}" -ge 6 ] 2>/dev/null; then BC2=bad;  BN2="BAN DALGASI — acil incele"
    elif [ "${BAN24:-0}" -ge 3 ] 2>/dev/null; then BC2=warn; BN2="ban hızlandı"
    elif [ "${BAN24:-0}" -ge 1 ] 2>/dev/null; then BC2=warn; BN2="normal seyir"
    else                                           BC2=ok;   BN2="24 saatte ban yok"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Son 24s ban</div><div class=\"num $BC2\">${BAN24:-0}</div><div class=\"sub\">${BN2} · 7 günde ${BAN7:-0}</div></div>"
    if [ "${KIS24:-0}" -gt 0 ] 2>/dev/null; then KC2=warn; else KC2=ok; fi
    echo "<div class=\"card\"><div class=\"lbl\">Son 24s kısıt</div><div class=\"num $KC2\">${KIS24:-0}</div><div class=\"sub\">yeni kısıtlanan hesap</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Diğer</div><div class=\"num sm dim\">${HFAIL:-0}<span class=\"unit\">/${HOUT:-0}</span></div><div class=\"sub\">kayıt başarısız / çıkış yapmış</div></div>"
    echo "</div>"
    if [ -n "$BANSERI" ] && [ "$BANSERI" != "-" ]; then
      BMAX=1
      for _p in $(echo "$BANSERI" | tr ',' ' '); do
        _n=$(echo "$_p" | cut -d: -f2); [ "${_n:-0}" -gt "$BMAX" ] 2>/dev/null && BMAX=$_n
      done
      BBARS=""
      for _p in $(echo "$BANSERI" | tr ',' ' '); do
        _d=$(echo "$_p" | cut -d: -f1); _n=$(echo "$_p" | cut -d: -f2)
        _hh=$(( ${_n:-0} * 44 / BMAX )); [ "$_hh" -lt 4 ] && _hh=4
        BBARS="$BBARS<div class=\"col\" title=\"ayın ${_d}'i · ${_n} ban\"><i style=\"background:var(--bad);height:${_hh}px\"></i><em>${_d}</em></div>"
      done
      echo "<div class=\"chart\" style=\"margin-top:10px\">$BBARS</div><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-top:7px\">günlük ban serisi (7 gün) · ani sıçrama = dalga başlangıcı</div>"
    fi
    fi   # DBOK

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2>Dayanıklılık <span class=\"hint\">servis · yedek · uçtan uca test</span></h2><div class=\"grid\">"
    if [ "$S_KOTU" -eq 0 ] && [ "$DKR" -ge 2 ]; then SVC=ok; SVV="hepsi ayakta"; else SVC=bad; SVV="${S_KOTU} sorunlu"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Servisler</div><div class=\"num sm $SVC\">${SVV}</div><div class=\"sub\">api ${S_API} · panel ${S_PANEL} · ajan ${S_AG} · gözcü ${S_GOZ} · container ${DKR}/2</div></div>"
    if [ "${FAILED_U:-0}" -eq 0 ] 2>/dev/null; then FUC=ok; else FUC=bad; fi
    echo "<div class=\"card\"><div class=\"lbl\">Hatalı birim</div><div class=\"num $FUC\">${FAILED_U:-?}</div><div class=\"sub\">systemd failed · taban 0 olmalı</div></div>"
    if   [ "$GZYAS" -le 25 ] 2>/dev/null; then GC2=ok;   GN2="tur dönüyor"
    elif [ "$GZYAS" -le 60 ] 2>/dev/null; then GC2=warn; GN2="tur gecikti (${GZYAS} dk)"
    else                                       GC2=bad;  GN2="GÖZCÜ DURMUŞ (${GZYAS} dk)"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Gözcü turu</div><div class=\"num sm $GC2\">${GZTIME:-?}</div><div class=\"sub\">${GN2} · ${GZSAGLAM:-?} sağlıklı</div></div>"
    if   [ "${YDB:-99}" -lt 0 ] 2>/dev/null; then YC=bad;  YT="YOK"
    elif [ "${YDB}" -le 26 ] 2>/dev/null;    then YC=ok;   YT="${YDB} sa"
    elif [ "${YDB}" -le 50 ] 2>/dev/null;    then YC=warn; YT="${YDB} sa"
    else                                          YC=bad;  YT="${YDB} sa"; fi
    echo "<div class=\"card\"><div class=\"lbl\">DB yedeği</div><div class=\"num sm $YC\">${YT}</div><div class=\"sub\">${YDBN:-0} kopya · günlük 02:30</div></div>"
    if   [ "${YCIH:-99}" -lt 0 ] 2>/dev/null; then YC2=bad;  YT2="YOK"
    elif [ "${YCIH}" -le 26 ] 2>/dev/null;    then YC2=ok;   YT2="${YCIH} sa"
    elif [ "${YCIH}" -le 50 ] 2>/dev/null;    then YC2=warn; YT2="${YCIH} sa"
    else                                           YC2=bad;  YT2="${YCIH} sa"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Cihaz yedeği</div><div class=\"num sm $YC2\">${YT2}</div><div class=\"sub\">${YCIHN:-0} arşiv · günlük 03:00</div></div>"
    case "$CANV" in GEÇTİ) CC2=ok ;; BAŞARISIZ) CC2=bad ;; *) CC2=warn ;; esac
    echo "<div class=\"card\"><div class=\"lbl\">Canary — günlük</div><div class=\"num sm $CC2\">${CANV}</div><div class=\"sub\">${CANTIME:-?} · ${CANN}</div></div>"
    case "$CPV" in GEÇTİ) CC3=ok ;; BAŞARISIZ) CC3=bad ;; *) CC3=dim ;; esac
    echo "<div class=\"card\"><div class=\"lbl\">Canary — eş zamanlı</div><div class=\"num sm $CC3\">${CPV}</div><div class=\"sub\">${CPTIME:-haftalık} · ${CPN}</div></div>"
    # ★11 Eyl: panelde 4 hayalet cihaz vardı (instance silinmiş, DB kaydı kalmış).
    if [ -n "$DBCIH" ] && [ "$DBOK" = "1" ]; then
      HAYALET=$(( DBCIH - TOP )); [ "$HAYALET" -lt 0 ] && HAYALET=0
      if [ "$HAYALET" -gt 0 ]; then HC2=warn; HN2="${HAYALET} kayıt fazla — silinmiş cihazın DB izi"
      else HC2=ok; HN2="panel ve sistem aynı"; fi
    else HAYALET="?"; HC2=dim; HN2="ölçülemedi"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Panel / sistem</div><div class=\"num sm $HC2\">${DBCIH:-?}<span class=\"unit\">/${TOP}</span></div><div class=\"sub\">${HN2}</div></div>"
    echo "</div>"

    # ── Otonom kurtarma
    if [ "$RN" = "0" ]; then RC=dim; elif [ "$RAVGDK" -lt 5 ]; then RC=ok; elif [ "$RAVGDK" -lt 15 ]; then RC=warn; else RC=bad; fi
    echo "<h2>Otonom kurtarma <span class=\"hint\">son 24 saat · müdahalesiz</span></h2><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">Ortalama kalkış</div><div class=\"num $RC\">${RAVGDK}<span class=\"unit\">dk</span></div><div class=\"sub\">${RAVG} sn · kendiliğinden toparlanma</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Medyan</div><div class=\"num\">${RMEDDK}<span class=\"unit\">dk</span></div><div class=\"sub\">tipik cihaz · ${RMED} sn</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">En kötü</div><div class=\"num\">${RMAXDK}<span class=\"unit\">dk</span></div><div class=\"sub\">en uzun süren kurtarma</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Kurtarma sayısı</div><div class=\"num\">${RN}</div><div class=\"sub\">reconnect ${RREC} · restart ${RZOM} · kendi ${RKEN}</div></div>"
    if [ "$DOWNN" = "0" ]; then DWC=ok; else DWC=warn; fi
    echo "<div class=\"card\"><div class=\"lbl\">Şu an düşük</div><div class=\"num $DWC\">${DOWNN}</div><div class=\"sub\">kurtarılmayı bekliyor</div></div>"
    echo "</div>"
    [ -n "$DOWNL" ] && echo "<div class=\"wide accent-warn\" style=\"margin-top:10px\"><div class=\"lbl\">Şu an düşük cihazlar</div><div class=\"body\">${DOWNL}</div><div class=\"sub\">gözcü 7 dk'da bir tarar · D-state eşiği aşılmadıkça beklemez</div></div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2>Donanım ve çekirdek <span class=\"hint\">derin sinyaller</span></h2><div class=\"grid\">"
    # ★PSI, D-state'ten hassas: D-state anlık sayımdır, PSI "son 10 sn'de ne kadar
    # beklenildi" der — kısa ama tekrarlayan takılmaları yakalar.
    _pi=${PSI_IO%%.*}
    if   [ "${_pi:-0}" -ge 20 ] 2>/dev/null; then PC2=bad;  PN2="I/O KİLİDİ — süreçler bekliyor"
    elif [ "${_pi:-0}" -ge 5 ] 2>/dev/null;  then PC2=warn; PN2="I/O baskısı artıyor"
    else                                          PC2=ok;   PN2="baskı yok"; fi
    echo "<div class=\"card\"><div class=\"lbl\">I/O baskısı (PSI)</div><div class=\"num $PC2\">${PSI_IO}<span class=\"unit\">%</span></div><div class=\"sub\">${PN2} · some ${PSI_IOS}% · <b>D-state'ten hassas</b></div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">CPU baskısı</div><div class=\"num sm\">${PSI_CPU}<span class=\"unit\">%</span></div><div class=\"sub\">bekleyen süreç oranı · bellek ${PSI_MEM}%</div></div>"
    if   [ "$TMAX" -ge 85 ]; then TC2=bad;  TN2="THROTTLE RİSKİ"
    elif [ "$TMAX" -ge 75 ]; then TC2=warn; TN2="ısındı"
    elif [ "$TMAX" -gt 0 ];  then TC2=ok;   TN2="normal · ${TAD}"
    else                          TC2=dim;  TN2="sensör okunamadı"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Sıcaklık</div><div class=\"num $TC2\">${TMAX}<span class=\"unit\">°C</span></div><div class=\"sub\">${TN2} · 85°C üzeri throttle</div></div>"
    # ★3 Eyl tracefs/eventfs deadlock'u procs_blocked'a HİÇ yansımamıştı.
    if [ "$KTOP" -gt 0 ]; then KC=bad; KV="UYARI"; KN="hung=${HUNG} oops=${OOPS} oom=${OOMK} — dmesg'e bak"
    else KC=ok; KV="temiz"; KN="son 400 satırda kilit/oops/OOM izi yok"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Çekirdek izleri</div><div class=\"num sm $KC\">${KV}</div><div class=\"sub\">${KN}</div></div>"
    if   [ "$SIGAR" -le 5 ];  then KPC=bad;  KPN="TAVAN — yeni cihaz açma"
    elif [ "$SIGAR" -le 20 ]; then KPC=warn; KPN="tavana yaklaşıyor"
    else                           KPC=ok;   KPN="rahat"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Kapasite</div><div class=\"num $KPC\">+${SIGAR}</div><div class=\"sub\">cihaz daha sığar · ~${PERDEV} MB/cihaz · ${KPN}</div></div>"
    if [ "${SWPCT:-0}" -ge 20 ] 2>/dev/null; then SWC=warn; else SWC=ok; fi
    echo "<div class=\"card\"><div class=\"lbl\">Swap</div><div class=\"num sm $SWC\">${SWPCT}<span class=\"unit\">%</span></div><div class=\"sub\">tek başına alarm DEĞİL · RAM ile birlikte okunur</div></div>"
    if [ "${BINDN:-0}" = "$ACIK" ]; then BDC=ok; BDN="cihaz başına 1 · tutarlı"; else BDC=warn; BDN="cihaz sayısıyla ayrışıyor — mount sızıntısı"; fi
    echo "<div class=\"card\"><div class=\"lbl\">binderfs</div><div class=\"num sm $BDC\">${BINDN:-?}</div><div class=\"sub\">${BDN}</div></div>"
    if   [ "${VARLOG:-0}" -ge 8000 ] 2>/dev/null; then LC=bad;  LN="log şişti — rotasyona bak"
    elif [ "${VARLOG:-0}" -ge 4000 ] 2>/dev/null; then LC=warn; LN="büyüyor"
    else                                               LC=ok;   LN="normal"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Log boyutu</div><div class=\"num sm $LC\">${VARLOG:-?}<span class=\"unit\">MB</span></div><div class=\"sub\">${LN} · journal ${JRNL:-?}</div></div>"
    echo "</div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2>Güvenlik ve veritabanı</h2><div class=\"grid\">"
    if   [ "$SSHFAIL" -ge 20 ]; then SEC=bad;  SEN="${SSHFAIL} başarısız giriş — tarama olabilir"
    elif [ "$SSHFAIL" -ge 1 ];  then SEC=warn; SEN="${SSHFAIL} başarısız deneme"
    elif [ "$SSHIP" -gt 1 ];    then SEC=warn; SEN="${SSHIP} farklı IP giriş yaptı"
    else                             SEC=ok;   SEN="yalnız bilinen kaynak · parola girişi kapalı"; fi
    echo "<div class=\"card\"><div class=\"lbl\">SSH girişi</div><div class=\"num sm $SEC\">${SSHFAIL}<span class=\"unit\"> başarısız</span></div><div class=\"sub\">${SEN} · ${SSHIP} kaynak IP</div></div>"
    if [ "$SIRIZ" = "600" ] && [ "${UFWD:-0}" = "1" ]; then SRC=ok; SRV="tamam"; SRN="ufw açık · sırlar 600"
    else SRC=bad; SRV="BAK"; SRN="ufw=${UFWD:-?} agent.env=${SIRIZ:-?}"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Sıkılaştırma</div><div class=\"num sm $SRC\">${SRV}</div><div class=\"sub\">${SRN}</div></div>"
    if [ "$DBOK" = "1" ]; then
      if [ "${ALRMONAY:-0}" -ge 1000 ] 2>/dev/null; then AC2=warn; else AC2=dim; fi
      echo "<div class=\"card\"><div class=\"lbl\">Onaysız alarm</div><div class=\"num sm $AC2\">${ALRMONAY:-?}</div><div class=\"sub\">birikmiş · 24 saatte ${ALRM24:-?} yeni</div></div>"
      echo "<div class=\"card\"><div class=\"lbl\">Veritabanı</div><div class=\"num sm\">${DBBOY:-?}</div><div class=\"sub\">en büyük: ${DBENB:-?}</div></div>"
      echo "<div class=\"card\"><div class=\"lbl\">Ölü satır</div><div class=\"num sm dim\">${DBOLU:-?}</div><div class=\"sub\">autovacuum eşiği %20 · altındaysa temizlenmez</div></div>"
    fi
    echo "</div>"
    if [ "$DBOK" = "1" ] && [ -n "$ALRMZ" ] && [ "$ALRMZ" != "-" ]; then
      echo "<div class=\"wide accent-warn\" style=\"margin-top:10px\"><div class=\"lbl\">Son alarm · ${ALRMZ}</div><div class=\"body\">$(echo "${ALRMB:--}" | esc)</div><div class=\"sub\">24 saatin en sıkı: $(echo "${ALRMSIK:--}" | esc)</div></div>"
    fi

    # ══════════════════════════════════════════════════════════════════════
    # Seyir grafikleri + katlanabilir ham veri
    # ══════════════════════════════════════════════════════════════════════
    BARS=""
    while read -r v; do
      [ -z "$v" ] && continue
      H=$(( v * 52 / TOP )); [ "$H" -lt 3 ] && H=3
      BARS="$BARS<div class=\"col\" title=\"${v} cihaz\"><i style=\"background:var(--info);height:${H}px\"></i></div>"
    done < <(tail -30 "$L" 2>/dev/null | grep -oE "acik=[0-9]+" | cut -d= -f2)
    DBARS=""
    while read -r v; do
      [ -z "$v" ] && continue
      H=$(( v * 52 / 100 )); [ "$H" -lt 3 ] && H=3; [ "$H" -gt 52 ] && H=52
      if [ "$v" -ge 50 ]; then C="var(--bad)"; elif [ "$v" -ge 25 ]; then C="var(--warn)"; else C="var(--ok)"; fi
      DBARS="$DBARS<div class=\"col\" title=\"D=${v}\"><i style=\"background:${C};height:${H}px\"></i></div>"
    done < <(tail -30 "$L" 2>/dev/null | grep -oE " D=[0-9]+" | cut -d= -f2)
    echo "<h2>Son 10 dakika</h2><div class=\"two\">"
    echo "<div><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-bottom:6px\">Açık cihaz seyri</div><div class=\"chart\">$BARS</div></div>"
    echo "<div><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-bottom:6px\">D-state seyri</div><div class=\"chart\">$DBARS</div></div>"
    echo "</div>"

    # ★Ham veri KAPALI gelir. Eskiden sayfanın yarısını yiyordu ve gerçek
    # uyarıları aşağı itiyordu — arıza anında görünürlüğü öldüren şey buydu.
    SORUN=$(awk -F'|' '$2=="NOIP" || ($2 ~ /^19|^10/ && $6=="-") {printf "%s ", $1}' "$S" 2>/dev/null | fold -w 100 -s | head -4 | esc)
    [ -z "$SORUN" ] && SORUN="(sorunlu cihaz yok)"
    FRENLOG=$(tail -8 /var/log/wd-fren.log 2>/dev/null | tac | esc)
    [ -z "$FRENLOG" ] && FRENLOG="(şişme kaydı yok — sistem hiç zorlanmadı)"
    echo "<h2>Ham veri</h2>"
    echo "<details><summary>Sorunlu cihaz listesi</summary><pre>${SORUN}</pre></details>"
    echo "<details><summary>Fren kaydı (şişme oldu mu)</summary><pre>${FRENLOG}</pre></details>"
    echo "<details><summary>Son 30 ölçüm turu</summary><pre>$(tail -30 "$L" 2>/dev/null | tac | esc)</pre></details>"

    echo '</div></body></html>'
  } > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

  sleep 10
done
