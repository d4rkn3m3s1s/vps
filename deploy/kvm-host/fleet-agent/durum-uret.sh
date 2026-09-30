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
# ★escn: HTML NITELIGI icine giren degerler icin. esc yalnizca & < > cevirir;
# deger data-ara="..." gibi bir niteligin icindeyse cift tirnak da kacisilmali,
# yoksa nitelik erken kapanip onclick= enjekte edilebilir.
escn(){ sed 's/&/\&amp;/g;s/</\&lt;/g;s/>/\&gt;/g;s/"/\&quot;/g;s/'"'"'/\&#39;/g'; }

# ★★★2026-09-12 TUR SAYACI + YAVAS ADIM ONBELLEGI.
# Dongu 10 sn'de bir doner ama bazi olcumler 10 saniyede DEGISMEZ ve pahalidir:
#   journalctl -u ssh (x2)=689ms, ufw status=100ms, docker ps=74ms,
#   dmesg tail 400=73ms, du -sm /var/log=61ms  ->  toplam ~1 sn + journal yuku.
# Bunlar 30 TURDA BIR (5 dakika) olculur; arada onceki deger kullanilir.
# Filo sayilari (acik cihaz, D-state, sizinti) HER TUR taze kalir.
TUR=0
while true; do
  TUR=$((TUR+1))
  if [ $(( (TUR-1) % 30 )) -eq 0 ]; then YAVAS=1; else YAVAS=0; fi
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
  # ★dg de kacisiyor: detay.txt icindeki dcip DIS SERVISTEN geliyor
  # (api.ipify.org / ifconfig.me / icanhazip.com) ve cikis IP listesi de oyle.
  dg(){ grep "^$1=" "$DETAY" 2>/dev/null | cut -d= -f2- | escn; }
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
  # ★★★GUVENLIK: okuyucu KENDISI kacisiyor. DB ozeti AlertRule.name,
  # AlertEvent.title, Device.metadata gibi YAZILABILIR alanlardan besleniyor;
  # bu degerlerin hepsi HTML'e giriyor. Tek tek 12 kullanim yerini duzeltmek
  # yanlis cozumdu -- 13. metrigi eklerken yine unuturdum. Okuyucu guvenli
  # olunca HTML'e giden her DB degeri TANIM GEREGI guvenli olur.
  # Sayisal testler bozulmaz: escape yalnizca & < > " ' cevirir.
  db(){ grep "^$1|" "$DBO" 2>/dev/null | head -1 | cut -d'|' -f2 | escn; }
  db2(){ grep "^$1|" "$DBO" 2>/dev/null | head -1 | cut -d'|' -f3 | escn; }
  db3(){ grep "^$1|" "$DBO" 2>/dev/null | head -1 | cut -d'|' -f4 | escn; }
  dbn(){ grep "^$1|" "$DBO" 2>/dev/null | head -1 | cut -d'|' -f"$2" | escn; }
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

  # ★2026-09-30 YAŞAYAN FİLO + GERÇEK TESLİM (durum-ozet.sql'deki açıklamaya bak).
  # Yeni satırlar yoksa (eski DB özeti) eski tüm-zamanlar sayılarına düşülür.
  TES_OK=$(dbn teslim24 2); TES_TOP=$(dbn teslim24 3); TES_SEB=$(dbn teslim24 4)
  if [ -n "$TES_TOP" ] && [ "$TES_TOP" -gt 0 ] 2>/dev/null; then TESORAN=$(( TES_OK * 100 / TES_TOP )); else TESORAN=""; fi
  HC_TOP=$(dbn hesap_canli 7)
  if [ -n "$HC_TOP" ] && [ "$HC_TOP" -gt 0 ] 2>/dev/null; then
    HACT=$(dbn hesap_canli 2); HBAN=$(dbn hesap_canli 3); HKIS=$(dbn hesap_canli 4)
    HOUT=$(dbn hesap_canli 5); HYOK=$(dbn hesap_canli 6)
  fi
  BAN24C=$(dbn ban_canli 2); BAN7C=$(dbn ban_canli 3)
  [ -n "$BAN24C" ] && { BAN24=$BAN24C; BAN7=$BAN7C; }

  ISTOP=$(( ${IS_OK:-0} + ${IS_FAIL:-0} ))
  if [ "$ISTOP" -gt 0 ] 2>/dev/null; then ISORAN=$(( ${IS_OK:-0} * 100 / ISTOP )); else ISORAN=100; fi
  HTOP=$(( ${HACT:-0} + ${HBAN:-0} + ${HKIS:-0} ))
  if [ "$HTOP" -gt 0 ] 2>/dev/null; then HORAN=$(( ${HACT:-0} * 100 / HTOP )); else HORAN=0; fi
  [ -n "$HC_TOP" ] && [ "$HC_TOP" -gt 0 ] 2>/dev/null && HORAN=$(( ${HACT:-0} * 100 / HC_TOP ))

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
  [ "$YAVAS" = "1" ] && _dm=$(dmesg 2>/dev/null | tail -400)
  [ "$YAVAS" = "1" ] && { HUNG=$(printf '%s' "$_dm" | grep -ciE "hung_task|blocked for more than|INFO: task.*blocked"); HUNG=${HUNG:-0}; }
  [ "$YAVAS" = "1" ] && { OOPS=$(printf '%s' "$_dm" | grep -ciE "Oops|kernel BUG|general protection"); OOPS=${OOPS:-0}; }
  [ "$YAVAS" = "1" ] && { OOMK=$(printf '%s' "$_dm" | grep -ci "Out of memory: Killed"); OOMK=${OOMK:-0}; }
  KTOP=$(( ${HUNG:-0} + ${OOPS:-0} + ${OOMK:-0} ))
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
  [ "$YAVAS" = "1" ] && { DKR=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -c '^fleet-'); DKR=${DKR:-0}; }
  FAILED_U=$(systemctl list-units --state=failed --no-legend --plain 2>/dev/null | wc -l)

  # ★Yedek "var" demek yetmez — KAÇ SAATLİK olduğu önemli. Timer bozulursa
  # yedek sessizce eskir ve felaket anında günlerce veri gider.
  yedekyas(){ _f=$(ls -t $1 2>/dev/null | head -1); [ -z "$_f" ] && { echo -1; return; }
              _t=$(stat -c %Y "$_f" 2>/dev/null); [ -z "$_t" ] && { echo -1; return; }
              echo $(( ($(date +%s) - _t) / 3600 )); }
  if [ "$YAVAS" = "1" ]; then
    YDB=$(yedekyas '/opt/db-backups/*.gz');        YDBN=$(ls /opt/db-backups/*.gz 2>/dev/null | wc -l)
    YCIH=$(yedekyas '/opt/device-backups/*.tgz');  YCIHN=$(ls /opt/device-backups/*.tgz 2>/dev/null | wc -l)
  fi

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
    # ★GUVENLIK: instance adi down-* DOSYA ADINDAN geliyor; ham gomulmez.
    _inG=$(printf '%s' "$_in" | escn)
    _dkN=$(printf '%s' "$_dk" | tr -cd '0-9'); _dkN=${_dkN:-0}
    DOWNL="$DOWNL<span class=\"chip warn\">${_inG} · ${_dkN}dk</span>"
  done

  # ════════════════════════════════════════════════════════════════════════
  # BÖLÜM 5 — PROXY HAVUZU + GÜVENLİK
  # ════════════════════════════════════════════════════════════════════════
  # ★6 Eyl: 141/143 cihaz TEK proxy hesabına bağlıydı; o hesap düşünce filonun
  # tamamı çıkışsız kaldı. Tek hesaba bağımlılık SESSİZ bir tekil arıza noktası.
  # ★30 Eyl: port rolleri 27 Eyl'de TERS döndü (mobil 5555, residential 9999) ve sabit
  # "9999=TR mobil" varsayımı sayacı yanlış gösteriyordu (0/155). Portlar artık env'den.
  MPORT=$(grep -oP '^FLEET_PROXY_MOBILE_PORT=\K[0-9]+' /etc/fleet-proxy.env 2>/dev/null); MPORT=${MPORT:-5555}
  RPORT=$(grep -oP '^FLEET_PROXY_PORT=\K[0-9]+' /etc/fleet-proxy.env 2>/dev/null); RPORT=${RPORT:-9999}
  PTR=$(grep -lE "^[[:space:]]*port = ${MPORT};" /etc/redsocks-inst-*.conf 2>/dev/null | wc -l)
  PAL=$(grep -lE "^[[:space:]]*port = ${RPORT};" /etc/redsocks-inst-*.conf 2>/dev/null | wc -l)
  PTOP=$((PTR + PAL))
  if [ "$PTOP" -gt 0 ]; then PTRPCT=$(( PTR * 100 / PTOP )); else PTRPCT=0; fi
  IPKUME=$(awk -F'|' '{print $6}' "$S" 2>/dev/null | grep -E '^[0-9]' | cut -d. -f1-2 | sort -u | wc -l)
  IPTOP=$(awk -F'|' '{print $6}' "$S" 2>/dev/null | grep -E '^[0-9]' | sort -u | wc -l)

  if [ "$YAVAS" = "1" ]; then
    # ★Tek journal taramasi, iki sonuc: eskiden AYNI sorgu iki kez kosuyordu (689 ms).
    _ssh=$(journalctl -u ssh --since "24 hours ago" --no-pager 2>/dev/null)
    SSHFAIL=$(printf '%s' "$_ssh" | grep -ci "failed password"); SSHFAIL=${SSHFAIL:-0}
    SSHIP=$(printf '%s' "$_ssh" | grep -i "accepted" | grep -oE "from [0-9.]+" | sort -u | wc -l); SSHIP=${SSHIP:-0}
    unset _ssh
    UFWD=$(ufw status 2>/dev/null | head -1 | grep -c active)
  fi
  SIRIZ=$(stat -c %a /opt/fleet-agent/agent.env 2>/dev/null)
  if [ "$YAVAS" = "1" ]; then
    JRNL=$(journalctl --disk-usage 2>/dev/null | grep -oE '[0-9.]+[MG]' | tail -1)
    VARLOG=$(du -sm /var/log 2>/dev/null | cut -f1)
  fi

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
  # ══════════════════════════════════════════════════════════════════════════
  # ★★★2026-09-12 v4 EK VERİLER
  # ══════════════════════════════════════════════════════════════════════════

  # ── 24 SAATLİK FİLO TRENDİ — DB'siz, log tabanlı (ölçülen: 56 ms).
  # ★Sayfadaki diğer grafik yalnızca son 10 dakikayı gösteriyor. Gece yaşanan
  # bir düşüş sabah bakıldığında GÖRÜNMÜYORDU. Bu awk, wd-izle.log'un tamamını
  # (≈3900 ölçüm) saat başına özetler: ortalama açık cihaz, D-state, load.
  # ★DB'ye gitmiyoruz: aynı bilgiyi DeviceMetricPoint'ten almak 1246 ms sürüyor
  # ve zaten hep 143 döndürüyor (cihaz sayısı, açık cihaz değil).
  TREND24=$(awk -F"[ =|]+" '
  {
    h=substr($1,1,2)
    for(i=1;i<=NF;i++){
      if($i=="acik"){split($(i+1),a,"/"); s[h]+=a[1]; n[h]++}
      if($i=="D"){d[h]+=$(i+1)}
      if($i=="load"){l[h]+=$(i+1)}
    }
  }
  END{ for(k in s) printf "%s:%d:%d:%d\n", k, s[k]/n[k], d[k]/n[k], l[k]/n[k] }
  ' "$L" 2>/dev/null | sort | tr "\n" "," | sed 's/,$//')

  # ── DB özetinden gelen v4 metrikleri
  KAYITSIZ=$(db kayitsiz);        KAYITSIZLST=$(db kayitsiz_liste)
  EMEKLI=$(db emekli);            EMEKLI24=$(db2 emekli)
  EMEKLISON=$(db emekli_son)
  KONUSMA=$(db konusma);          KONUSMATOP=$(db2 konusma)
  ULKE=$(db ulke)
  KURALAKTIF=$(db kural_ozet);    KURALTOP=$(db2 kural_ozet);  KURALTETIK=$(db3 kural_ozet)
  KURALTOP4=$(db kural_top);      KURALTAZE=$(db kural_taze)

  # ══════════════════════════════════════════════════════════════════════════
  # HTML
  # ══════════════════════════════════════════════════════════════════════════
  {
    cat <<'HEAD'
<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Filo Durumu</title><style>
/* ══════════════════════════════════════════════════════════════════════════
   TASARIM SİSTEMİ
   Tek ölçek: 4px grid. Renk YALNIZCA anlam taşıdığında — her kart renkliyse
   hiçbiri göze batmaz ve arıza anında bu öldürücüdür.
   ══════════════════════════════════════════════════════════════════════════ */
:root{
  --bg:#0a0b0e; --card:#14161b; --card2:#1a1d24; --line:#232732; --line2:#2d3240;
  --fg:#eceef2; --fg2:#9aa1b0; --fg3:#6a7280;
  --ok:#34d399; --warn:#fbbf24; --bad:#f87171; --info:#60a5fa; --purple:#a78bfa;
  --r:14px; --rs:9px;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6);
}
html[data-tema="acik"]{
  --bg:#f6f7f9; --card:#fff; --card2:#f1f3f6; --line:#e3e6ec; --line2:#d5d9e2;
  --fg:#11131a; --fg2:#525a6b; --fg3:#78808f;
  --ok:#059669; --warn:#b45309; --bad:#dc2626; --info:#2563eb; --purple:#7c3aed;
  --shadow:0 1px 2px rgba(16,24,40,.06),0 8px 24px -12px rgba(16,24,40,.14);
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);
  font:400 14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;padding:0 16px 56px;transition:background .2s,color .2s}
.wrap{max-width:1220px;margin:0 auto}

/* ── Sticky üst çubuk: sayfa kayarken durum hep görünür ─────────────────── */
.bar{position:sticky;top:0;z-index:50;margin:0 -16px 0;padding:10px 16px;
  background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.bar .pill{display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:99px;
  background:var(--card);border:1px solid var(--line);font-size:12.5px;font-weight:500;white-space:nowrap}
.bar .pill b{font-variant-numeric:tabular-nums}
.bar .dot{width:7px;height:7px;border-radius:99px;flex:0 0 auto}
.bar .sp{flex:1}
.btn{padding:5px 11px;border-radius:99px;background:var(--card);border:1px solid var(--line);
  color:var(--fg2);font-size:12.5px;cursor:pointer;font-family:inherit;white-space:nowrap;
  transition:background .15s,color .15s,border-color .15s}
.btn:hover{background:var(--card2);color:var(--fg);border-color:var(--line2)}
.btn.on{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.btn kbd{font:inherit;font-size:10.5px;opacity:.6;margin-left:4px}

/* ── Başlık ────────────────────────────────────────────────────────────── */
.top{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;
  padding:22px 0 16px}
h1{font-size:21px;font-weight:650;letter-spacing:-.015em}
.meta{color:var(--fg3);font-size:12.5px;font-variant-numeric:tabular-nums}

/* ── Karar şeridi: sayfanın tek büyük görsel öğesi ──────────────────────── */
.verdict{border-radius:var(--r);padding:17px 20px;margin-bottom:24px;
  display:flex;align-items:center;gap:15px;border:1px solid var(--line);
  background:var(--card);box-shadow:var(--shadow)}
.verdict .ring{width:11px;height:11px;border-radius:99px;flex:0 0 auto}
.verdict .txt b{display:block;font-size:17px;font-weight:650;letter-spacing:-.012em;margin-bottom:2px}
.verdict .txt span{color:var(--fg2);font-size:13px}
.v-iyi{border-color:color-mix(in srgb,var(--ok) 30%,var(--line))}
.v-iyi .ring{background:var(--ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok) 18%,transparent)}
.v-iyi b{color:var(--ok)}
.v-uyari{border-color:color-mix(in srgb,var(--warn) 34%,var(--line))}
.v-uyari .ring{background:var(--warn);box-shadow:0 0 0 4px color-mix(in srgb,var(--warn) 18%,transparent)}
.v-uyari b{color:var(--warn)}
.v-kritik{border-color:color-mix(in srgb,var(--bad) 38%,var(--line))}
.v-kritik .ring{background:var(--bad);box-shadow:0 0 0 4px color-mix(in srgb,var(--bad) 20%,transparent)}
.v-kritik b{color:var(--bad)}

/* ── Bölüm başlığı (tıklanınca daralır) ─────────────────────────────────── */
h2{font-size:11.5px;font-weight:600;color:var(--fg3);text-transform:uppercase;
  letter-spacing:.085em;margin:28px 0 12px;display:flex;align-items:center;gap:10px;
  cursor:pointer;user-select:none}
h2:hover{color:var(--fg2)}
h2 .caret{font-size:9px;transition:transform .18s;display:inline-block;opacity:.65}
h2.kapali .caret{transform:rotate(-90deg)}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
h2 .hint{text-transform:none;letter-spacing:0;font-weight:400;color:var(--fg3);font-size:11.5px}
.sec{transition:opacity .15s}
.sec.gizli{display:none}

/* ── Kart ızgarası ─────────────────────────────────────────────────────── */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(182px,1fr));gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:14px 15px;min-height:106px;display:flex;flex-direction:column;
  transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--line2)}
.card .lbl{font-size:11px;font-weight:500;color:var(--fg3);text-transform:uppercase;
  letter-spacing:.045em;line-height:1.35;min-height:15px}
.card .num{font-size:28px;font-weight:650;letter-spacing:-.025em;line-height:1.12;
  margin-top:7px;font-variant-numeric:tabular-nums}
.card .num.sm{font-size:19px;letter-spacing:-.008em}
.card .unit{font-size:13px;font-weight:500;color:var(--fg3);margin-left:2px}
.card .sub{font-size:11.5px;color:var(--fg3);line-height:1.5;margin-top:auto;padding-top:7px}
.ok{color:var(--ok)} .warn{color:var(--warn)} .bad{color:var(--bad)}
.info{color:var(--info)} .dim{color:var(--fg3)} .purple{color:var(--purple)}

.bar-t{height:5px;border-radius:99px;background:var(--line);overflow:hidden;margin-top:9px}
.bar-t>i{display:block;height:100%;border-radius:99px;transition:width .4s}

/* ── Geniş kart ────────────────────────────────────────────────────────── */
.wide{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:14px 16px;margin-top:10px}
.wide.a-warn{border-left:3px solid var(--warn)}
.wide.a-bad{border-left:3px solid var(--bad)}
.wide.a-ok{border-left:3px solid var(--ok)}
.wide.a-info{border-left:3px solid var(--info)}
.wide .lbl{font-size:11px;font-weight:500;color:var(--fg3);text-transform:uppercase;
  letter-spacing:.045em;display:flex;align-items:center;gap:8px}
.wide .body{margin-top:8px;font-size:13.5px;line-height:1.65}
.wide .sub{font-size:11.5px;color:var(--fg3);margin-top:7px;line-height:1.5}

/* ── Grafik ────────────────────────────────────────────────────────────── */
.chart{display:flex;align-items:flex-end;gap:2px;height:78px;
  background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 12px 8px}
.chart.tall{height:104px}
.col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;
  gap:4px;min-width:0;position:relative}
.col i{display:block;width:100%;border-radius:3px 3px 0 0;transition:opacity .15s}
.col:hover i{opacity:.75}
.col em{font-style:normal;font-size:9px;color:var(--fg3);font-variant-numeric:tabular-nums}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.legend{font-size:11.5px;color:var(--fg3);margin-top:7px;display:flex;gap:14px;flex-wrap:wrap}
.legend span{display:inline-flex;align-items:center;gap:5px}
.legend i{width:9px;height:9px;border-radius:2px;display:inline-block}

/* ── Rozet ─────────────────────────────────────────────────────────────── */
.chip{display:inline-block;margin:3px 6px 3px 0;padding:3px 10px;border-radius:99px;
  background:var(--card2);border:1px solid var(--line);font-size:12px;font-variant-numeric:tabular-nums}
.chip.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 25%,transparent)}
.chip.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 25%,transparent)}

/* ── CİHAZ TABLOSU ─────────────────────────────────────────────────────── */
.tbl-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.search{flex:1;min-width:190px;position:relative}
.search input{width:100%;padding:8px 12px 8px 32px;border-radius:var(--rs);
  background:var(--card);border:1px solid var(--line);color:var(--fg);
  font:inherit;font-size:13px;outline:none;transition:border-color .15s}
.search input:focus{border-color:color-mix(in srgb,var(--info) 55%,var(--line))}
.search::before{content:"⌕";position:absolute;left:11px;top:50%;transform:translateY(-50%);
  color:var(--fg3);font-size:15px}
.tbl-wrap{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  overflow:hidden}
.tbl-scroll{max-height:420px;overflow-y:auto;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12.5px}
thead th{position:sticky;top:0;background:var(--card2);z-index:2;
  padding:9px 11px;text-align:left;font-weight:600;font-size:10.5px;color:var(--fg3);
  text-transform:uppercase;letter-spacing:.05em;white-space:nowrap;cursor:pointer;
  border-bottom:1px solid var(--line);user-select:none}
thead th:hover{color:var(--fg2)}
thead th .ar{opacity:.4;font-size:9px;margin-left:3px}
thead th.srt .ar{opacity:1;color:var(--info)}
tbody td{padding:8px 11px;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent);
  white-space:nowrap;font-variant-numeric:tabular-nums}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--card2)}
tbody tr.gizli{display:none}
td.ad{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px}
.tag{display:inline-block;padding:1.5px 7px;border-radius:99px;font-size:10.5px;font-weight:500}
.tag.ok{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}
.tag.warn{background:color-mix(in srgb,var(--warn) 15%,transparent);color:var(--warn)}
.tag.bad{background:color-mix(in srgb,var(--bad) 15%,transparent);color:var(--bad)}
.tag.dim{background:var(--card2);color:var(--fg3)}
.tbl-ft{padding:8px 12px;border-top:1px solid var(--line);font-size:11.5px;color:var(--fg3);
  display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}

/* ── Katlanabilir ham veri ─────────────────────────────────────────────── */
details{background:var(--card);border:1px solid var(--line);border-radius:var(--r);margin-top:10px}
summary{padding:12px 16px;cursor:pointer;font-size:12.5px;color:var(--fg2);
  list-style:none;display:flex;align-items:center;gap:8px;user-select:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"▸";color:var(--fg3);font-size:11px;transition:transform .15s}
details[open] summary::before{transform:rotate(90deg)}
details pre{margin:0;padding:0 16px 14px;overflow-x:auto;font-size:11.5px;line-height:1.7;
  color:var(--fg2);font-family:ui-monospace,"SF Mono",Menlo,monospace}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}

/* Kopyala */
.cp{margin-left:auto;padding:2px 9px;border-radius:99px;background:var(--card2);
  border:1px solid var(--line);color:var(--fg3);font-size:10.5px;cursor:pointer;font-family:inherit}
.cp:hover{color:var(--fg);border-color:var(--line2)}

/* Klavye yardımı */
.kbd-help{position:fixed;inset:0;background:rgba(0,0,0,.66);z-index:100;
  display:none;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)}
.kbd-help.acik{display:flex}
.kbd-box{background:var(--card);border:1px solid var(--line2);border-radius:var(--r);
  padding:20px 24px;max-width:340px;width:100%;box-shadow:var(--shadow)}
.kbd-box h3{font-size:13px;font-weight:650;margin-bottom:13px}
.kbd-row{display:flex;justify-content:space-between;gap:14px;padding:5px 0;font-size:12.5px;color:var(--fg2)}
.kbd-row kbd{background:var(--card2);border:1px solid var(--line2);border-radius:5px;
  padding:1px 7px;font:inherit;font-size:11.5px;color:var(--fg)}

/* ══════════════════════════════════════════════════════════════════════════
   ★2026-09-30 CANLILIK KATMANI — yalnız görsel; veri JS'siz de aynı.
   Sayfa 10 sn'de bir yenilenir: sayılar ÖNCEKİ değerden yeniye akar, değişen
   kart kısa bir parıltı + ▲/▼ farkıyla kendini belli eder. Hareket hassasiyeti
   ayarı açık olan tarayıcıda hepsi kapanır.
   ══════════════════════════════════════════════════════════════════════════ */
.bar{overflow:hidden}
.bar .tik{position:absolute;left:0;bottom:-1px;height:2px;width:100%;transform-origin:left;
  background:linear-gradient(90deg,var(--info),var(--purple));opacity:.75;transform:scaleX(0)}
.bar .tik.run{animation:tik 10s linear forwards}
@keyframes tik{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.verdict .ring{position:relative}
.verdict .ring::after{content:"";position:absolute;inset:0;border-radius:99px;background:inherit}
.v-iyi .ring::after{animation:nefes 3.2s ease-out infinite}
.v-uyari .ring::after{animation:nefes 1.8s ease-out infinite}
.v-kritik .ring::after{animation:nefes 1s ease-out infinite}
@keyframes nefes{0%{transform:scale(1);opacity:.7}100%{transform:scale(3.4);opacity:0}}
.bar .dot{position:relative}
.bar .dot::after{content:"";position:absolute;inset:0;border-radius:99px;background:inherit;animation:nefes 2.4s ease-out infinite}
.card,.wide{position:relative}
.card.degisti{animation:parilti 1.6s ease-out}
@keyframes parilti{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--info) 55%,transparent);border-color:var(--info)}
  100%{box-shadow:0 0 0 10px transparent}}
.fark{position:absolute;top:10px;right:11px;font-size:10.5px;font-weight:650;padding:1px 6px;
  border-radius:99px;font-variant-numeric:tabular-nums;animation:farkUcu 3.5s ease-out forwards}
.fark.up{color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,transparent)}
.fark.dn{color:var(--bad);background:color-mix(in srgb,var(--bad) 14%,transparent)}
@keyframes farkUcu{0%{opacity:0;transform:translateY(4px)}12%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0}}
.ilk .card,.ilk .wide,.ilk .chart{animation:giris .5s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes giris{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.card:hover{transform:translateY(-2px)}
.bar-t>i{transition:width .9s cubic-bezier(.2,.8,.2,1)}
.col i{transform-origin:bottom}
.ilk .col i{animation:kolon .7s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes kolon{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.saat{font-variant-numeric:tabular-nums;color:var(--fg2)}
.konfeti{position:fixed;top:-12px;width:8px;height:12px;border-radius:2px;z-index:90;pointer-events:none;
  animation:dus linear forwards}
@keyframes dus{to{transform:translateY(105vh) rotate(720deg);opacity:.2}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}

@media(max-width:760px){
  body{padding:0 11px 40px}
  .bar{margin:0 -11px;padding:9px 11px;gap:8px}
  .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .card{min-height:96px;padding:12px 13px}
  .card .num{font-size:24px}
  .two{grid-template-columns:1fr}
  .verdict{padding:15px 16px}
  .tbl-scroll{max-height:340px}
}
</style></head><body><div class="wrap">
HEAD
    # ── Sticky üst çubuk: sayfa kayarken durum hep görünür ────────────────
    case "$OZS" in iyi) BDOT="var(--ok)" ;; uyari) BDOT="var(--warn)" ;; *) BDOT="var(--bad)" ;; esac
    echo "<div class=\"bar\">"
    echo "<span class=\"pill\"><i class=\"dot\" style=\"background:${BDOT}\"></i>${OZB}</span>"
    echo "<span class=\"pill\">Cihaz <b>${ACIK}/${TOP}</b></span>"
    echo "<span class=\"pill\">D-state <b>${D}</b></span>"
    if [ "$DBOK" = "1" ] && [ -n "$TESORAN" ]; then echo "<span class=\"pill\">Teslim <b>%${TESORAN}</b></span>"
    elif [ "$DBOK" = "1" ]; then echo "<span class=\"pill\">İş <b>%${ISORAN}</b></span>"; fi
    [ "$DBOK" = "1" ] && echo "<span class=\"pill\">Ban 24s <b>${BAN24:-0}</b></span>"
    echo "<span class=\"sp\"></span>"
    echo "<span class=\"pill dim\" id=\"sayac\">10 sn</span>"
    echo "<button class=\"btn on\" id=\"btn-duraklat\" title=\"p\">⏸ Duraklat</button>"
    echo "<button class=\"btn\" id=\"btn-tema\" title=\"t\">☾</button>"
    echo "<button class=\"btn\" id=\"btn-kbd\" title=\"?\">⌨</button>"
    echo "</div>"

    # ── Başlık
    echo "<div class=\"top\"><h1>Filo Durumu</h1><div class=\"meta\">sayım ${SONSAAT:-?} · derin tarama ${DZAMAN:-bekleniyor} · DB özeti ${DBSAAT:-?}</div></div>"

    # ── Karar şeridi
    echo "<div class=\"verdict v-${OZS}\"><div class=\"ring\"></div><div class=\"txt\"><b>${OZB}</b><span>${OZT}</span></div></div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2 data-sec=\"filo\"><span class=\"caret\">▼</span>Filo <span class=\"hint\">20 saniyelik sayım turu</span></h2><div class=\"sec\" id=\"sec-filo\"><div class=\"grid\">"
    if [ "$ACIK" -ge $(( TOP * 90 / 100 )) ]; then AC=ok; elif [ "$ACIK" -ge $(( TOP * 50 / 100 )) ]; then AC=warn; else AC=bad; fi
    ABC="var(--${AC})"
    echo "<div class=\"card\"><div class=\"lbl\">Açık cihaz</div><div class=\"num $AC\">${ACIK}<span class=\"unit\">/${TOP}</span></div><div class=\"bar-t\"><i style=\"width:${YUZDE}%;background:${ABC}\"></i></div><div class=\"sub\">%${YUZDE} ayakta</div></div>"
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
    if [ "$DBOK" = "1" ] && [ -n "$EMEKLI24" ]; then
      echo "<div class=\"card\"><div class=\"lbl\">Emekli instance</div><div class=\"num sm dim\">${EMEKLI24}<span class=\"unit\">/${EMEKLI:-?}</span></div><div class=\"sub\">24 saatte / toplam · son ${EMEKLISON:-?}</div></div>"
    fi
    echo "</div>"

    # ── 24 SAATLİK FİLO TRENDİ (log tabanlı, DB'siz — 56 ms)
    # ★Sayfadaki diğer grafik yalnızca son 10 dakikayı gösteriyordu. Gece
    # yaşanan bir düşüş sabah bakıldığında görünmüyordu; bu grafik onu tutar.
    if [ -n "$TREND24" ]; then
      TBARS=""
      for _p in $(echo "$TREND24" | tr ',' ' '); do
        _h=$(echo "$_p" | cut -d: -f1); _a=$(echo "$_p" | cut -d: -f2)
        _d=$(echo "$_p" | cut -d: -f3); _l=$(echo "$_p" | cut -d: -f4)
        _hh=$(( ${_a:-0} * 64 / (TOP>0?TOP:1) )); [ "$_hh" -lt 3 ] && _hh=3; [ "$_hh" -gt 64 ] && _hh=64
        # Tam filo yeşil, eksik olan saat turuncu — gece düşüşü tek bakışta.
        if [ "${_a:-0}" -ge $(( TOP * 97 / 100 )) ] 2>/dev/null; then _c="var(--ok)"
        elif [ "${_a:-0}" -ge $(( TOP * 80 / 100 )) ] 2>/dev/null; then _c="var(--warn)"
        else _c="var(--bad)"; fi
        TBARS="$TBARS<div class=\"col\" title=\"${_h}:00 · ${_a} cihaz açık · D=${_d} · load ${_l}\"><i style=\"background:${_c};height:${_hh}px\"></i><em>${_h}</em></div>"
      done
      echo "<h2 data-sec=\"trend\"><span class=\"caret\">▼</span>24 saatlik filo seyri <span class=\"hint\">saat başına ortalama</span></h2><div class=\"sec\" id=\"sec-trend\">"
      echo "<div class=\"chart tall\">$TBARS</div>"
      echo "<div class=\"legend\"><span><i style=\"background:var(--ok)\"></i>tam filo (%97+)</span><span><i style=\"background:var(--warn)\"></i>eksik (%80-97)</span><span><i style=\"background:var(--bad)\"></i>ciddi düşüş</span><span class=\"dim\">üstüne gel: D-state ve load</span></div></div>"
    fi

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2 data-sec=\"ag\"><span class=\"caret\">▼</span>Ağ ve proxy <span class=\"hint\">2 dakikalık derin tarama</span></h2><div class=\"sec\" id=\"sec-ag\"><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">IP almış</div><div class=\"num\">${IP:-?}</div><div class=\"sub\">IP yok: ${NOIP:-?}</div></div>"
    if [ "${BOOTSUZN:-0}" -gt 0 ] 2>/dev/null; then BC=bad; BN="$BOOTSUZN cihaz YARIM AÇILMIŞ"; else BC=ok; BN="boot tamamlandı"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Android açık</div><div class=\"num $BC\">${BOOT:-?}</div><div class=\"sub\">${BN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">İnternet + proxy</div><div class=\"num ok\">${NET:-?}</div><div class=\"sub\">dışarı çıkabiliyor</div></div>"
    if [ "$SIZ" = "?" ] || [ -z "$DCIP" ]; then SC=warn; SN="ÖLÇÜLEMEDİ — host çıkış IP'si alınamadı"
    elif [ "${SIZ:-0}" -gt 0 ] 2>/dev/null; then SC=bad; SN="BAN RİSKİ — proxy devrede değil"
    else SC=ok; SN="proxy hepsinde devrede"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Proxy sızıntısı</div><div class=\"num $SC\">${SIZ}</div><div class=\"sub\">${SN}</div></div>"
    if [ "${CIKSIZN:-0}" -gt 0 ] 2>/dev/null; then CKC=warn; CKN="dışarı çıkamıyor — WhatsApp çalışmaz"; else CKC=ok; CKN="hepsi dışarı çıkabiliyor"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Çıkışı yok</div><div class=\"num $CKC\">${CIKSIZN:-0}</div><div class=\"sub\">${CKN}</div></div>"
    if   [ "$PAYMAX" -ge 5 ]; then PC=bad;  PN="HAVUZ DARALDI — ${PAYMAX} cihaz aynı IP'de"
    elif [ "$PAYMAX" -ge 3 ]; then PC=warn; PN="${PAYKUME} kümede paylaşım — izle"
    elif [ "$PAYMAX" -ge 2 ]; then PC=ok;   PN="normal (mobil havuz çakışması)"
    else                          PC=ok;   PN="her cihaz kendi IP'sinde"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Paylaşılan çıkış</div><div class=\"num $PC\">${PAYMAX}<span class=\"unit\">/IP</span></div><div class=\"sub\">${PN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Çıkış IP çeşitliliği</div><div class=\"num sm\">${IPTOP:-?}</div><div class=\"sub\">benzersiz IP · ${IPKUME:-?} farklı /16 küme</div></div>"
    if   [ "$PTRPCT" -ge 95 ]; then HC=warn; HN="TEK HAVUZA BAĞIMLI — düşerse filo çıkışsız"
    elif [ "$PTRPCT" -ge 80 ]; then HC=warn; HN="ağırlık tek havuzda"
    else                           HC=ok;   HN="havuzlar dengeli"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Havuz dağılımı</div><div class=\"num sm $HC\">${PTR:-?}<span class=\"unit\">/${PAL:-?}</span></div><div class=\"sub\">mobil / residential · ${HN}</div></div>"
    [ "$DBOK" = "1" ] && [ -n "$ULKE" ] && echo "<div class=\"card\"><div class=\"lbl\">Ülke dağılımı</div><div class=\"num sm\">${ULKE}</div><div class=\"sub\">proxy ülkesine göre</div></div>"
    echo "</div>"

    [ -n "$CIKIS" ] && echo "<div class=\"wide\"><div class=\"lbl\">Proxy çıkış IP örnekleri<button class=\"cp\" data-kopya=\"${CIKIS}\">kopyala</button></div><div class=\"body mono info\">${CIKIS}</div><div class=\"sub\">TR/AL mobil olmalı · host IP <span class=\"mono\">${DCIP:-?}</span> — bu IP çıkarsa SIZINTI</div></div>"
    if [ -n "$PAYLST" ] && [ "${PAYMAX:-0}" -ge 2 ]; then
      echo "<div class=\"wide a-${PC}\"><div class=\"lbl\">Aynı çıkış IP'sini paylaşan cihazlar</div><div class=\"body mono\">${PAYLST}</div><div class=\"sub\">${PAYCIH} cihaz · ${PAYKUME} küme · en büyük küme ${PAYMAX} · IP(kaç cihaz) biçiminde</div></div>"
    fi
    if [ -n "$BOOTSUZ$CIKSIZ" ]; then
      echo "<div class=\"wide a-bad\"><div class=\"lbl\">Dikkat isteyen cihazlar<button class=\"cp\" data-kopya=\"$(echo "$BOOTSUZ $CIKSIZ" | escn)\">kopyala</button></div><div class=\"body\">"
      [ -n "$BOOTSUZ" ] && echo "<div><b class=\"bad\">Yarım açılmış (Android boot bitmedi):</b> <span class=\"mono\">$(echo "$BOOTSUZ" | esc)</span></div>"
      [ -n "$CIKSIZ" ]  && echo "<div><b class=\"warn\">Çıkışı yok (dışarı ulaşamıyor):</b> <span class=\"mono\">$(echo "$CIKSIZ" | esc)</span></div>"
      echo "</div></div>"
    fi
    echo "</div>"

    # ══════════════════════════════════════════════════════════════════════
    # CİHAZ TABLOSU — aranabilir / filtrelenebilir / sıralanabilir
    # ★Sayfanın en çok istenen özelliği: "paneldeki bu numara hangi cihaz?"
    # sorusunu tek bakışta çözer. instance ↔ numara eşlemesi
    # Device.metadata->>'instance' üzerinden yapılır.
    # ══════════════════════════════════════════════════════════════════════
    CIHAZDOSYA=/opt/fleet-agent/state/cihazlar.txt
    if [ -s "$CIHAZDOSYA" ]; then
      CSAYI=$(grep -c '^c|' "$CIHAZDOSYA" 2>/dev/null)
      echo "<h2 data-sec=\"cihazlar\"><span class=\"caret\">▼</span>Cihazlar <span class=\"hint\">${CSAYI} kayıt · ara, süz, sırala</span></h2><div class=\"sec\" id=\"sec-cihazlar\">"
      echo "<div class=\"tbl-ctl\">"
      echo "<div class=\"search\"><input type=\"text\" id=\"cihaz-ara\" placeholder=\"instance, numara, durum ara…  ( / )\" autocomplete=\"off\"></div>"
      echo "<button class=\"btn\" id=\"btn-sorun\" title=\"s\">○ Yalnız sorunlular</button>"
      echo "</div>"
      echo "<div class=\"tbl-wrap\"><div class=\"tbl-scroll\"><table id=\"cihaz-tbl\"><thead><tr>"
      echo "<th>Instance<span class=\"ar\">▼</span></th><th>Numara<span class=\"ar\">▼</span></th><th>Durum<span class=\"ar\">▼</span></th><th>Ülke<span class=\"ar\">▼</span></th><th>24s iş<span class=\"ar\">▼</span></th><th>Başarısız<span class=\"ar\">▼</span></th><th>Hesap<span class=\"ar\">▼</span></th><th>Son<span class=\"ar\">▼</span></th>"
      echo "</tr></thead><tbody id=\"cihaz-body\">"
      # c|instance|ad|durum|ülke|iş|fail|hesap|saat
      while IFS='|' read -r _t _ins _ad _drm _ulk _is _fail _hes _saat; do
        [ "$_t" = "c" ] || continue
        # ★Sorunlu tanımı: başarısız işi olan VEYA çevrimdışı VEYA hesabı
        # banlı/kısıtlı VEYA WhatsApp kaydı eksik (adı numara değil).
        _sorun=0
        [ "${_failN:-0}" -gt 0 ] 2>/dev/null && _sorun=1
        [ "$_drm" != "ONLINE" ] && _sorun=1
        # ★Hesap durumu CIHAZ sorunu DEGIL: 16 FAILED kayit denemesi saglam
        # cihazlara bagliydi ve bunlari sorunlu saymak 43 SAHTE kirmizi
        # uretiyordu. Hesap durumu kendi sutununda rozetle gosteriliyor.
        case "$_ad" in +[0-9]*) : ;; *) _sorun=1 ;; esac
        # Renkler
        case "$_drm" in ONLINE) _dc="ok" ;; *) _dc="bad" ;; esac
        case "$_hes" in
          ACTIVE) _hc="ok" ;;
          BANNED) _hc="bad" ;;
          RESTRICTED|LOGGED_OUT|FAILED) _hc="warn" ;;
          *) _hc="dim" ;;
        esac
        if [ "${_fail:-0}" -gt 0 ] 2>/dev/null; then _fc="bad"; else _fc="dim"; fi
        # ★GUVENLIK: her alan ayri ayri kacisilir. Kaynak DB ve metadata
        # panel/API uzerinden yazilabilir; ham gommek depolanmis XSS demektir.
        _insG=$(printf '%s' "$_ins"  | escn)
        _adG=$(printf  '%s' "$_ad"   | escn)
        _drmG=$(printf '%s' "$_drm"  | escn)
        _ulkG=$(printf '%s' "$_ulk"  | escn)
        _hesG=$(printf '%s' "$_hes"  | escn)
        _saatG=$(printf '%s' "$_saat" | escn)
        # Sayisal alanlar: rakam disini at (siralama data-s niteligine de girer)
        _isN=$(printf '%s' "$_is"   | tr -cd '0-9'); _isN=${_isN:-0}
        _failN=$(printf '%s' "$_fail" | tr -cd '0-9'); _failN=${_failN:-0}
        echo "<tr data-ara=\"${_insG} ${_adG} ${_drmG} ${_ulkG} ${_hesG}\" data-sorun=\"${_sorun}\"><td class=\"ad\">${_insG}</td><td class=\"ad\">${_adG}</td><td><span class=\"tag ${_dc}\">${_drmG}</span></td><td>${_ulkG}</td><td data-s=\"${_isN}\">${_isN}</td><td data-s=\"${_failN}\" class=\"${_fc}\">${_failN}</td><td><span class=\"tag ${_hc}\">${_hesG}</span></td><td class=\"dim\">${_saatG}</td></tr>"
      done < "$CIHAZDOSYA"
      echo "</tbody></table></div>"
      echo "<div class=\"tbl-ft\"><span id=\"cihaz-sayac\">${CSAYI} / ${CSAYI} cihaz</span><span>en çok başarısız işi olan üstte · başlığa tıkla: sırala</span></div>"
      echo "</div></div>"
    fi

    # ══════════════════════════════════════════════════════════════════════
    # İŞ AKIŞI
    # ══════════════════════════════════════════════════════════════════════
    if [ "$DBOK" != "1" ]; then
      echo "<h2 data-sec=\"is\"><span class=\"caret\">▼</span>İş akışı</h2><div class=\"sec\" id=\"sec-is\"><div class=\"wide a-warn\"><div class=\"lbl\">İş katmanı ölçülemiyor</div><div class=\"body warn\">DB özeti ${DBYAS} dk önce güncellendi — tazesi 90 sn'de bir gelmeli</div><div class=\"sub\">wd-durum-db.service çalışmıyor olabilir · kartlar gösterilmiyor çünkü bayat veri, veri olmamasından tehlikelidir</div></div></div>"
    else
    echo "<h2 data-sec=\"is\"><span class=\"caret\">▼</span>İş akışı <span class=\"hint\">son 24 saat · panel veritabanı</span></h2><div class=\"sec\" id=\"sec-is\"><div class=\"grid\">"
    if   [ "$ISORAN" -ge 95 ]; then IC=ok;   IN="normal işleyiş"
    elif [ "$ISORAN" -ge 85 ]; then IC=warn; IN="başarısızlık arttı"
    else                           IC=bad;  IN="CİDDİ — işler tutmuyor"; fi
    if [ -n "$TESORAN" ]; then
      if   [ "$TESORAN" -ge 90 ]; then TC=ok;   TN="mesajlar gidiyor"
      elif [ "$TESORAN" -ge 75 ]; then TC=warn; TN="gitmeyen arttı"
      else                             TC=bad;  TN="CİDDİ — mesajlar gitmiyor"; fi
      echo "<div class=\"card\"><div class=\"lbl\">Mesaj teslim</div><div class=\"num $TC\">${TESORAN}<span class=\"unit\">%</span></div><div class=\"bar-t\"><i style=\"width:${TESORAN}%;background:var(--${TC})\"></i></div><div class=\"sub\">${TES_OK}/${TES_TOP} gitti · ${TN}<br>gitmeyen: ${TES_SEB:--}</div></div>"
    fi
    echo "<div class=\"card\"><div class=\"lbl\">İş başarı oranı</div><div class=\"num $IC\">${ISORAN}<span class=\"unit\">%</span></div><div class=\"bar-t\"><i style=\"width:${ISORAN}%;background:var(--${IC})\"></i></div><div class=\"sub\">${IS_OK:-?} tamam · ${IS_FAIL:-?} başarısız · ${IN} · <i>iş çalıştı mı (mesaj gitti mi değil)</i></div></div>"
    case "${GOND:-?}" in
      ''|'?') GC=dim; GN="ölçülemedi" ;;
      *) if   [ "${GOND}" -le 20 ] 2>/dev/null; then GC=ok;   GN="hedefte (12-17 sn tipik)"
         elif [ "${GOND}" -le 35 ] 2>/dev/null; then GC=warn; GN="yavaşladı"
         else GC=bad; GN="ÇOK YAVAŞ"; fi ;;
    esac
    echo "<div class=\"card\"><div class=\"lbl\">Gönderim süresi</div><div class=\"num $GC\">${GOND:-?}<span class=\"unit\">sn</span></div><div class=\"sub\">medyan · p95 ${GONP95:-?} sn · ${GN}</div></div>"
    case "${KUYS:-?}" in
      ''|'?') KC=dim; KN="ölçülemedi" ;;
      *) if   [ "${KUYS}" -le 5 ] 2>/dev/null;  then KC=ok;   KN="kuyruk akıyor"
         elif [ "${KUYS}" -le 30 ] 2>/dev/null; then KC=warn; KN="birikme başladı"
         else KC=bad; KN="KUYRUK TIKANDI"; fi ;;
    esac
    echo "<div class=\"card\"><div class=\"lbl\">Kuyruk beklemesi</div><div class=\"num $KC\">${KUYS:-?}<span class=\"unit\">sn</span></div><div class=\"sub\">iş oluşup başlayana kadar · ${KN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Şu an işleniyor</div><div class=\"num\">${BEKL:-?}</div><div class=\"sub\">PENDING + RUNNING</div></div>"
    if [ "${IS_FAIL:-0}" -gt 0 ] 2>/dev/null && [ "${FAILCIH:-0}" -gt 0 ] 2>/dev/null; then
      FPAY=$(( FAILCIH * 100 / IS_FAIL ))
      if [ "$FPAY" -ge 50 ]; then FN="çoğu TEK cihazda — o cihaza bak"; else FN="filoya dağılmış — sistemik olabilir"; fi
      FC=warn
    else FN="başarısız iş yok"; FC=ok; fi
    echo "<div class=\"card\"><div class=\"lbl\">Başarısızlık dağılımı</div><div class=\"num sm $FC\">${FAILCIH:-0}<span class=\"unit\">/${IS_FAIL:-0}</span></div><div class=\"sub\">${FN}</div></div>"
    # ★Kaydı eksik cihaz: ONLINE görünür, iş alır, ama mesaj GÖNDEREMEZ.
    if [ -n "$KAYITSIZ" ] && [ "${KAYITSIZ:-0}" -gt 0 ] 2>/dev/null; then
      echo "<div class=\"card\"><div class=\"lbl\">WhatsApp kaydı eksik</div><div class=\"num sm warn\">${KAYITSIZ}</div><div class=\"sub\">ONLINE ama mesaj gönderemez</div></div>"
    fi
    echo "</div>"
    [ -n "$ISTIPLER" ] && echo "<div class=\"wide\"><div class=\"lbl\">İş tipleri · tamam/başarısız</div><div class=\"body mono\">${ISTIPLER}</div></div>"
    [ -n "$JFSEBEP" ] && [ "$JFSEBEP" != "-" ] && echo "<div class=\"wide a-warn\"><div class=\"lbl\">En sık iş hatası</div><div class=\"body\">${JFSEBEP}</div></div>"
    if [ -n "$KAYITSIZLST" ] && [ "$KAYITSIZLST" != "-" ]; then
      echo "<div class=\"wide a-warn\"><div class=\"lbl\">WhatsApp kaydı tamamlanmamış cihazlar<button class=\"cp\" data-kopya=\"${KAYITSIZLST}\">kopyala</button></div><div class=\"body mono\">${KAYITSIZLST}</div><div class=\"sub\">adı telefon numarası değil · filoda ONLINE sayılır ve iş alır, ama gönderim yapamaz</div></div>"
    fi

    if [ -n "$SAATLIK" ]; then
      SMAX=1
      for _p in $(echo "$SAATLIK" | tr ',' ' '); do
        _n=$(echo "$_p" | cut -d: -f2); [ "${_n:-0}" -gt "$SMAX" ] 2>/dev/null && SMAX=$_n
      done
      SBARS=""
      for _p in $(echo "$SAATLIK" | tr ',' ' '); do
        _h=$(echo "$_p" | cut -d: -f1); _n=$(echo "$_p" | cut -d: -f2); _f=$(echo "$_p" | cut -d: -f3)
        _hh=$(( ${_n:-0} * 68 / SMAX )); [ "$_hh" -lt 3 ] && _hh=3
        _c="var(--info)"
        [ "${_f:-0}" -gt 0 ] 2>/dev/null && [ "${_n:-1}" -gt 0 ] 2>/dev/null && \
          [ $(( _f * 100 / _n )) -ge 5 ] 2>/dev/null && _c="var(--bad)"
        SBARS="$SBARS<div class=\"col\" title=\"${_h}:00 · ${_n} iş · ${_f} başarısız\"><i style=\"background:${_c};height:${_hh}px\"></i><em>${_h}</em></div>"
      done
      echo "<div style=\"margin-top:14px\"><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-bottom:6px\">Saatlik iş yoğunluğu</div><div class=\"chart tall\">$SBARS</div>"
      echo "<div class=\"legend\"><span><i style=\"background:var(--info)\"></i>normal</span><span><i style=\"background:var(--bad)\"></i>başarısızlık %5+</span><span class=\"dim\">en yoğun saat ${SMAX} iş</span></div></div>"
    fi
    echo "</div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2 data-sec=\"teslimat\"><span class=\"caret\">▼</span>Mesaj teslimatı <span class=\"hint\">son 24 saat</span></h2><div class=\"sec\" id=\"sec-teslimat\"><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">Giden / gelen</div><div class=\"num sm\">${MOUT:-?}<span class=\"unit\"> / ${MIN:-?}</span></div><div class=\"sub\">OUT / IN mesaj</div></div>"
    if [ "${MDEL:-0}" -gt 0 ] 2>/dev/null; then TC=ok; TN="teslim onayı geliyor"; else TC=warn; TN="teslim onayı İŞLENMİYOR"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Teslim onayı</div><div class=\"num $TC\">${MDEL:-0}<span class=\"unit\">/${MOUT:-0}</span></div><div class=\"sub\">${TN}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Onay bekleyen</div><div class=\"num warn\">${MSENT:-0}</div><div class=\"sub\">SENT durumunda · medyan yaş ${SENTYAS:-?} dk</div></div>"
    if [ "${MFAIL:-0}" -gt 0 ] 2>/dev/null; then FMC=warn; else FMC=ok; fi
    echo "<div class=\"card\"><div class=\"lbl\">Gönderilemeyen</div><div class=\"num $FMC\">${MFAIL:-0}</div><div class=\"sub\">FAILED işaretli</div></div>"
    [ -n "$KONUSMA" ] && echo "<div class=\"card\"><div class=\"lbl\">Aktif sohbet</div><div class=\"num sm\">${KONUSMA}<span class=\"unit\">/${KONUSMATOP:-?}</span></div><div class=\"sub\">24 saatte güncellenen / toplam</div></div>"
    echo "</div>"
    echo "<div class=\"wide a-warn\"><div class=\"lbl\">Teslimat izi hakkında</div><div class=\"body\">Giden mesajların durumu <span class=\"mono\">SENT</span>'te kalıyor: teslimat onayı (DELIVERED/READ) sisteme <b>işlenmiyor</b>. Yani <b>&quot;gönderildi&quot; ≠ &quot;ulaştı&quot;</b> — iş <span class=\"mono\">COMPLETED</span> dönse bile mesajın karşıya ulaştığı <u>doğrulanmış değil</u>.</div><div class=\"sub\">En sık gönderim hatası: ${MFSEBEP:--}</div></div></div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2 data-sec=\"hesap\"><span class=\"caret\">▼</span>WhatsApp hesapları</h2><div class=\"sec\" id=\"sec-hesap\"><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">Aktif hesap</div><div class=\"num ok\">${HACT:-?}</div><div class=\"bar-t\"><i style=\"width:${HORAN}%;background:var(--ok)\"></i></div><div class=\"sub\">kullanılabilir oran %${HORAN}${HC_TOP:+ · ${HC_TOP} yaşayan cihaz${HYOK:+, ${HYOK} hesapsız}}</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Banlı</div><div class=\"num bad\">${HBAN:-?}</div><div class=\"sub\">kalıcı kayıp</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Kısıtlı</div><div class=\"num warn\">${HKIS:-?}</div><div class=\"sub\">yeni sohbet açamaz</div></div>"
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
        _hh=$(( ${_n:-0} * 48 / BMAX )); [ "$_hh" -lt 4 ] && _hh=4
        BBARS="$BBARS<div class=\"col\" title=\"ayın ${_d}'i · ${_n} ban\"><i style=\"background:var(--bad);height:${_hh}px\"></i><em>${_d}</em></div>"
      done
      echo "<div style=\"margin-top:12px\"><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-bottom:6px\">Günlük ban serisi (7 gün) · ani sıçrama = dalga başlangıcı</div><div class=\"chart\">$BBARS</div></div>"
    fi
    echo "</div>"
    fi   # DBOK

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2 data-sec=\"dayanik\"><span class=\"caret\">▼</span>Dayanıklılık <span class=\"hint\">servis · yedek · uçtan uca test</span></h2><div class=\"sec\" id=\"sec-dayanik\"><div class=\"grid\">"
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
    if [ -n "$DBCIH" ] && [ "$DBOK" = "1" ]; then
      HAYALET=$(( DBCIH - TOP )); [ "$HAYALET" -lt 0 ] && HAYALET=0
      if [ "$HAYALET" -gt 0 ]; then HC2=warn; HN2="${HAYALET} kayıt fazla — silinmiş cihazın DB izi"
      else HC2=ok; HN2="panel ve sistem aynı"; fi
    else HAYALET="?"; HC2=dim; HN2="ölçülemedi"; fi
    echo "<div class=\"card\"><div class=\"lbl\">Panel / sistem</div><div class=\"num sm $HC2\">${DBCIH:-?}<span class=\"unit\">/${TOP}</span></div><div class=\"sub\">${HN2}</div></div>"
    echo "</div>"

    if [ "$RN" = "0" ]; then RC=dim; elif [ "$RAVGDK" -lt 5 ]; then RC=ok; elif [ "$RAVGDK" -lt 15 ]; then RC=warn; else RC=bad; fi
    echo "<div style=\"margin-top:14px\"><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-bottom:8px\">Otonom kurtarma · son 24 saat · müdahalesiz</div><div class=\"grid\">"
    echo "<div class=\"card\"><div class=\"lbl\">Ortalama kalkış</div><div class=\"num $RC\">${RAVGDK}<span class=\"unit\">dk</span></div><div class=\"sub\">${RAVG} sn · kendiliğinden toparlanma</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Medyan</div><div class=\"num\">${RMEDDK}<span class=\"unit\">dk</span></div><div class=\"sub\">tipik cihaz · ${RMED} sn</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">En kötü</div><div class=\"num\">${RMAXDK}<span class=\"unit\">dk</span></div><div class=\"sub\">en uzun süren kurtarma</div></div>"
    echo "<div class=\"card\"><div class=\"lbl\">Kurtarma sayısı</div><div class=\"num\">${RN}</div><div class=\"sub\">reconnect ${RREC} · restart ${RZOM} · kendi ${RKEN}</div></div>"
    if [ "$DOWNN" = "0" ]; then DWC=ok; else DWC=warn; fi
    echo "<div class=\"card\"><div class=\"lbl\">Şu an düşük</div><div class=\"num $DWC\">${DOWNN}</div><div class=\"sub\">kurtarılmayı bekliyor</div></div>"
    echo "</div></div>"
    [ -n "$DOWNL" ] && echo "<div class=\"wide a-warn\"><div class=\"lbl\">Şu an düşük cihazlar</div><div class=\"body\">${DOWNL}</div><div class=\"sub\">gözcü 7 dk'da bir tarar · D-state eşiği aşılmadıkça beklemez</div></div>"
    echo "</div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2 data-sec=\"donanim\"><span class=\"caret\">▼</span>Donanım ve çekirdek <span class=\"hint\">derin sinyaller</span></h2><div class=\"sec\" id=\"sec-donanim\"><div class=\"grid\">"
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
    echo "</div></div>"

    # ══════════════════════════════════════════════════════════════════════
    echo "<h2 data-sec=\"guvenlik\"><span class=\"caret\">▼</span>Güvenlik · alarm · veritabanı</h2><div class=\"sec\" id=\"sec-guvenlik\"><div class=\"grid\">"
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
      [ -n "$KURALAKTIF" ] && echo "<div class=\"card\"><div class=\"lbl\">Alarm kuralı</div><div class=\"num sm\">${KURALAKTIF}<span class=\"unit\">/${KURALTOP:-?}</span></div><div class=\"sub\">aktif · toplam ${KURALTETIK:-?} tetikleme</div></div>"
      echo "<div class=\"card\"><div class=\"lbl\">Veritabanı</div><div class=\"num sm\">${DBBOY:-?}</div><div class=\"sub\">en büyük: ${DBENB:-?}</div></div>"
      echo "<div class=\"card\"><div class=\"lbl\">Ölü satır</div><div class=\"num sm dim\">${DBOLU:-?}</div><div class=\"sub\">autovacuum eşiği %20 · altındaysa temizlenmez</div></div>"
    fi
    echo "</div>"
    # ★Alarm kırılımı: "4132 onaysız" tek başına anlamsız bir yığın; hangi
    # kuralın tekrar ettiğini görmeden neyi düzelteceğini bilemezsin.
    if [ "$DBOK" = "1" ] && [ -n "$KURALTOP4" ] && [ "$KURALTOP4" != "-" ]; then
      echo "<div class=\"wide a-info\"><div class=\"lbl\">En çok tetiklenen alarm kuralları</div><div class=\"body mono\">$(echo "$KURALTOP4" | esc)</div><div class=\"sub\">son 24 saatte tetiklenen: $(echo "${KURALTAZE:-yok}" | esc)</div></div>"
    fi
    if [ "$DBOK" = "1" ] && [ -n "$ALRMZ" ] && [ "$ALRMZ" != "-" ]; then
      echo "<div class=\"wide a-warn\"><div class=\"lbl\">Son alarm · ${ALRMZ}</div><div class=\"body\">${ALRMB:--}</div><div class=\"sub\">24 saatin en sıkı: ${ALRMSIK:--}</div></div>"
    fi
    echo "</div>"

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
    echo "<h2 data-sec=\"son10\"><span class=\"caret\">▼</span>Son 10 dakika</h2><div class=\"sec\" id=\"sec-son10\"><div class=\"two\">"
    echo "<div><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-bottom:6px\">Açık cihaz seyri</div><div class=\"chart\">$BARS</div></div>"
    echo "<div><div class=\"sub\" style=\"color:var(--fg3);font-size:11.5px;margin-bottom:6px\">D-state seyri</div><div class=\"chart\">$DBARS</div></div>"
    echo "</div></div>"

    SORUN=$(awk -F'|' '$2=="NOIP" || ($2 ~ /^19|^10/ && $6=="-") {printf "%s ", $1}' "$S" 2>/dev/null | fold -w 100 -s | head -4 | esc)
    [ -z "$SORUN" ] && SORUN="(sorunlu cihaz yok)"
    FRENLOG=$(tail -8 /var/log/wd-fren.log 2>/dev/null | tac | esc)
    [ -z "$FRENLOG" ] && FRENLOG="(şişme kaydı yok — sistem hiç zorlanmadı)"
    echo "<h2 data-sec=\"ham\"><span class=\"caret\">▼</span>Ham veri</h2><div class=\"sec\" id=\"sec-ham\">"
    echo "<details><summary>Sorunlu cihaz listesi</summary><pre>${SORUN}</pre></details>"
    echo "<details><summary>Fren kaydı (şişme oldu mu)</summary><pre>${FRENLOG}</pre></details>"
    echo "<details><summary>Son 30 ölçüm turu</summary><pre>$(tail -30 "$L" 2>/dev/null | tac | esc)</pre></details>"
    echo "</div>"

    # ── Klavye yardım kutusu
    echo "<div class=\"kbd-help\" id=\"kbd\"><div class=\"kbd-box\"><h3>Klavye kısayolları</h3>"
    echo "<div class=\"kbd-row\"><span>Cihaz ara</span><kbd>/</kbd></div>"
    echo "<div class=\"kbd-row\"><span>Yalnız sorunlular</span><kbd>s</kbd></div>"
    echo "<div class=\"kbd-row\"><span>Yenilemeyi duraklat</span><kbd>p</kbd></div>"
    echo "<div class=\"kbd-row\"><span>Şimdi yenile</span><kbd>r</kbd></div>"
    echo "<div class=\"kbd-row\"><span>Açık / koyu tema</span><kbd>t</kbd></div>"
    echo "<div class=\"kbd-row\"><span>Bu pencere</span><kbd>?</kbd></div>"
    echo "<div class=\"kbd-row dim\"><span>Bölüm başlığına tıkla: daralt</span><kbd>Esc</kbd></div>"
    echo "</div></div>"

    # ── JS: arama/filtre/sıralama, yenileme kontrolü, tema, kısayollar
    # ★Sayfa JS OLMADAN DA tam çalışır; buradaki her şey ek kolaylık.
    cat <<'JSBLOK'
<script>
/* ══════════════════════════════════════════════════════════════════════════
   /durum — istemci tarafı etkileşim
   ★TASARIM KURALI: sayfa JS OLMADAN DA tam çalışır. Buradaki her şey ek
   kolaylık; hiçbir veri JS ile üretilmez. Arıza anında tarayıcı eklentisi
   JS'i bozsa bile operatör tüm sayıları görebilmeli.
   ══════════════════════════════════════════════════════════════════════════ */
(function(){
  var LS = {
    get: function(k,d){ try{ var v=localStorage.getItem('durum.'+k); return v===null?d:v; }catch(e){ return d; } },
    set: function(k,v){ try{ localStorage.setItem('durum.'+k,v); }catch(e){} }
  };

  /* ── TEMA ────────────────────────────────────────────────────────────── */
  var tema = LS.get('tema','koyu');
  if(tema==='acik') document.documentElement.setAttribute('data-tema','acik');
  function temaDegis(){
    tema = (tema==='koyu') ? 'acik' : 'koyu';
    if(tema==='acik') document.documentElement.setAttribute('data-tema','acik');
    else document.documentElement.removeAttribute('data-tema');
    LS.set('tema',tema);
    var b=document.getElementById('btn-tema'); if(b) b.textContent = tema==='koyu'?'☾':'☀';
  }

  /* ── OTOMATİK YENİLEME ────────────────────────────────────────────────
     ★meta refresh YERİNE JS: meta refresh durdurulamaz. Operatör bir tabloyu
     incelerken sayfanın altından kayması, bu sayfanın en can sıkıcı yanıydı.
     Duraklat bilgisi localStorage'da tutulur — yenilemeden sonra da korunur. */
  var SURE = 10, kalan = SURE, duraklat = LS.get('duraklat','0')==='1', timer=null;
  function tik(){
    if(duraklat || document.hidden) return;
    kalan--;
    var el=document.getElementById('sayac'); if(el) el.textContent = kalan+' sn';
    if(kalan<=0) location.reload();
  }
  function duraklatDegis(){
    duraklat=!duraklat; LS.set('duraklat',duraklat?'1':'0');
    var b=document.getElementById('btn-duraklat');
    if(b){ b.textContent = duraklat?'▶ Devam':'⏸ Duraklat'; b.className = 'btn'+(duraklat?'':' on'); }
    var el=document.getElementById('sayac');
    if(el) el.textContent = duraklat ? 'duraklatıldı' : kalan+' sn';
    if(!duraklat){ kalan=SURE; }
    var tk=document.querySelector('.bar .tik');
    if(tk && tk.parentNode) tk.parentNode.removeChild(tk);
    if(!duraklat){ var br=document.querySelector('.bar'); if(br){ var n=document.createElement('i'); n.className='tik run'; br.appendChild(n); } }
  }

  /* ── BÖLÜM DARALTMA ──────────────────────────────────────────────────── */
  function bolumKur(){
    var hs = document.querySelectorAll('h2[data-sec]');
    for(var i=0;i<hs.length;i++){
      (function(h){
        var id = h.getAttribute('data-sec');
        var sec = document.getElementById('sec-'+id);
        if(LS.get('sec.'+id,'acik')==='kapali'){ h.className='kapali'; if(sec) sec.className='sec gizli'; }
        h.addEventListener('click', function(){
          var kapali = h.className.indexOf('kapali')<0;
          h.className = kapali?'kapali':'';
          if(sec) sec.className = 'sec'+(kapali?' gizli':'');
          LS.set('sec.'+id, kapali?'kapali':'acik');
        });
      })(hs[i]);
    }
  }

  /* ── CİHAZ TABLOSU: arama + filtre + sıralama ────────────────────────── */
  var tbody, satirlar=[], sadeceSorun=false, sonSutun=-1, sonYon=1;
  function tabloKur(){
    tbody = document.getElementById('cihaz-body');
    if(!tbody) return;
    satirlar = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
    var inp = document.getElementById('cihaz-ara');
    if(inp) inp.addEventListener('input', suz);
    var f = document.getElementById('btn-sorun');
    if(f) f.addEventListener('click', function(){
      sadeceSorun=!sadeceSorun;
      f.className='btn'+(sadeceSorun?' on':'');
      f.textContent = sadeceSorun?'● Yalnız sorunlular':'○ Yalnız sorunlular';
      suz();
    });
    var ths = document.querySelectorAll('#cihaz-tbl thead th');
    for(var i=0;i<ths.length;i++){
      (function(th,idx){
        th.addEventListener('click', function(){ sirala(idx,th,ths); });
      })(ths[i],i);
    }
  }
  function suz(){
    var q = (document.getElementById('cihaz-ara')||{}).value || '';
    q = q.toLowerCase().trim();
    var gorunen=0;
    for(var i=0;i<satirlar.length;i++){
      var tr = satirlar[i];
      var metin = (tr.getAttribute('data-ara')||'').toLowerCase();
      var sorunlu = tr.getAttribute('data-sorun')==='1';
      var gec = (!q || metin.indexOf(q)>=0) && (!sadeceSorun || sorunlu);
      tr.className = gec?'':'gizli';
      if(gec) gorunen++;
    }
    var s=document.getElementById('cihaz-sayac');
    if(s) s.textContent = gorunen+' / '+satirlar.length+' cihaz';
  }
  function sirala(idx,th,ths){
    if(sonSutun===idx) sonYon=-sonYon; else { sonYon=1; sonSutun=idx; }
    for(var i=0;i<ths.length;i++){ ths[i].className=''; }
    th.className='srt';
    var ar = th.querySelector('.ar'); if(ar) ar.textContent = sonYon>0?'▼':'▲';
    var kopya = satirlar.slice();
    kopya.sort(function(a,b){
      var x=a.children[idx], y=b.children[idx];
      var xa=(x.getAttribute('data-s')!==null?x.getAttribute('data-s'):x.textContent).trim();
      var ya=(y.getAttribute('data-s')!==null?y.getAttribute('data-s'):y.textContent).trim();
      var xn=parseFloat(xa), yn=parseFloat(ya);
      if(!isNaN(xn) && !isNaN(yn)) return (xn-yn)*sonYon;
      return xa.localeCompare(ya,'tr')*sonYon;
    });
    for(var j=0;j<kopya.length;j++) tbody.appendChild(kopya[j]);
  }

  /* ── KOPYALA ─────────────────────────────────────────────────────────── */
  function kopyaKur(){
    var bs = document.querySelectorAll('[data-kopya]');
    for(var i=0;i<bs.length;i++){
      (function(b){
        b.addEventListener('click', function(e){
          e.stopPropagation();
          var t = b.getAttribute('data-kopya');
          var eski = b.textContent;
          function tamam(){ b.textContent='✓ kopyalandı'; setTimeout(function(){ b.textContent=eski; },1400); }
          if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(t).then(tamam, function(){});
          } else {
            var ta=document.createElement('textarea'); ta.value=t;
            document.body.appendChild(ta); ta.select();
            try{ document.execCommand('copy'); tamam(); }catch(err){}
            document.body.removeChild(ta);
          }
        });
      })(bs[i]);
    }
  }

  /* ── KLAVYE KISAYOLLARI ──────────────────────────────────────────────── */
  function kisayol(e){
    var t = e.target.tagName;
    if(t==='INPUT'||t==='TEXTAREA'){
      if(e.key==='Escape'){ e.target.value=''; suz(); e.target.blur(); }
      return;
    }
    if(e.key==='/'){ e.preventDefault(); var i=document.getElementById('cihaz-ara'); if(i){ i.focus(); i.select(); } }
    else if(e.key==='p'||e.key==='P'){ duraklatDegis(); }
    else if(e.key==='r'||e.key==='R'){ location.reload(); }
    else if(e.key==='t'||e.key==='T'){ temaDegis(); }
    else if(e.key==='s'||e.key==='S'){ var f=document.getElementById('btn-sorun'); if(f) f.click(); }
    else if(e.key==='?'){ var h=document.getElementById('kbd'); if(h) h.className='kbd-help acik'; }
    else if(e.key==='Escape'){ var h2=document.getElementById('kbd'); if(h2) h2.className='kbd-help'; }
  }

  /* ── ★2026-09-30 CANLILIK: önceki değerden akış + değişim parıltısı ─────
     Önceki turun sayıları sessionStorage'da; sayfa yenilenince her kart eski
     değerden yenisine sayar, değişen kart parlar ve ▲/▼ farkını gösterir.
     İlk ziyarette kartlar sırayla belirir ve sayılar 0'dan yükselir. */
  var SS = {
    get: function(k){ try{ return sessionStorage.getItem('durum.'+k); }catch(e){ return null; } },
    set: function(k,v){ try{ sessionStorage.setItem('durum.'+k,v); }catch(e){} }
  };
  var AZ = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function say(el, from, to){
    if(AZ || from===to){ return; }
    var t0=null, dur=Math.min(1200, 380+Math.abs(to-from)*14);
    function adim(t){
      if(t0===null) t0=t;
      var p=Math.min(1,(t-t0)/dur), e=1-Math.pow(1-p,3);
      el.nodeValue = String(Math.round(from+(to-from)*e));
      if(p<1) requestAnimationFrame(adim);
    }
    el.nodeValue=String(from); requestAnimationFrame(adim);
  }
  function canlilik(){
    var ilk = SS.get('gordu')!=='1';
    if(ilk && !AZ){ document.body.className+=' ilk'; SS.set('gordu','1');
      var kart=document.querySelectorAll('.card,.wide,.chart');
      for(var k=0;k<kart.length && k<60;k++) kart[k].style.animationDelay=(k*28)+'ms';
    }
    var onceki={}; try{ onceki=JSON.parse(SS.get('sayilar')||'{}'); }catch(e){}
    var simdi={};
    var cards=document.querySelectorAll('.card');
    for(var i=0;i<cards.length;i++){
      var c=cards[i], num=c.querySelector('.num'), lbl=c.querySelector('.lbl');
      if(!num||!lbl) continue;
      var tn=num.firstChild;
      if(!tn || tn.nodeType!==3 || !/^\s*-?\d+\s*$/.test(tn.nodeValue)) continue;
      var anahtar=lbl.textContent.trim()+'#'+i, deger=parseInt(tn.nodeValue,10);
      simdi[anahtar]=deger;
      var eski = (anahtar in onceki) ? onceki[anahtar] : (ilk ? 0 : deger);
      say(tn, eski, deger);
      if(!ilk && eski!==deger){
        c.className+=' degisti';
        var f=document.createElement('span'), d=deger-eski;
        f.className='fark '+(d>0?'up':'dn'); f.textContent=(d>0?'▲ ':'▼ ')+Math.abs(d);
        c.appendChild(f);
      }
    }
    SS.set('sayilar', JSON.stringify(simdi));
    // Kusursuz filo → oturum başına bir kez küçük bir kutlama.
    var v=document.querySelector('.verdict.v-iyi');
    if(v && !AZ && SS.get('kutlandi')!=='1'){
      SS.set('kutlandi','1');
      var renk=['#34d399','#60a5fa','#a78bfa','#fbbf24','#f472b6'];
      for(var q=0;q<42;q++){
        var p=document.createElement('i'); p.className='konfeti';
        p.style.left=(Math.random()*100)+'vw';
        p.style.background=renk[q%renk.length];
        p.style.animationDuration=(1.6+Math.random()*1.6)+'s';
        p.style.animationDelay=(Math.random()*0.5)+'s';
        document.body.appendChild(p);
        (function(el){ setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 4200); })(p);
      }
    }
    if(!document.querySelector('.verdict.v-iyi')) SS.set('kutlandi','0');
    // Yenileme ilerleme çizgisi + canlı saat
    var bar=document.querySelector('.bar');
    if(bar && !duraklat){ var tk=document.createElement('i'); tk.className='tik run'; bar.appendChild(tk); }
    var meta=document.querySelector('.top .meta');
    if(meta){
      var s=document.createElement('span'); s.className='saat';
      meta.insertBefore(s, meta.firstChild); meta.insertBefore(document.createTextNode(' · '), s.nextSibling);
      var saatYaz=function(){ s.textContent='🕒 '+new Date().toLocaleTimeString('tr-TR',{timeZone:'Europe/Istanbul'}); };
      saatYaz(); setInterval(saatYaz,1000);
    }
  }
  // Sekme arka plandayken sayaç durur (tik() document.hidden'da çıkar) → boşuna yenileme yok.

  /* ── BAŞLAT ──────────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function(){
    bolumKur(); tabloKur(); kopyaKur();
    try{ canlilik(); }catch(e){}
    var bt=document.getElementById('btn-tema');
    if(bt){ bt.textContent = tema==='koyu'?'☾':'☀'; bt.addEventListener('click',temaDegis); }
    var bd=document.getElementById('btn-duraklat');
    if(bd){
      bd.textContent = duraklat?'▶ Devam':'⏸ Duraklat';
      bd.className = 'btn'+(duraklat?'':' on');
      bd.addEventListener('click',duraklatDegis);
    }
    var el=document.getElementById('sayac');
    if(el) el.textContent = duraklat?'duraklatıldı':kalan+' sn';
    var kb=document.getElementById('kbd');
    if(kb) kb.addEventListener('click', function(){ kb.className='kbd-help'; });
    var kbb=document.getElementById('btn-kbd');
    if(kbb) kbb.addEventListener('click', function(){ if(kb) kb.className='kbd-help acik'; });
    document.addEventListener('keydown', kisayol);
    timer = setInterval(tik,1000);
  });
})();
</script>
JSBLOK

    echo '</div></body></html>'
  } > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

  sleep 10
done
