#!/bin/bash
# wd-run.sh <instance> — phoenixNAP: çözülen 8-adım setsid multi-instance boot.
# Agent hostShDetached ile çağırır (fire-and-forget). Boot sonrası ADB tcp açar.
INST="${1:?instance}"

# ★★★2026-08-17 BOOT DAMGASI — health-watch'in boot-grace'i BUNA dayanir.
# ESKIDEN grace "wd-run.sh <inst> sureci yasiyor mu" diye bakiyordu; ama bu betik
# container'i baslatip CIKIYOR -> surec yok -> grace ATLANIYOR -> boot eden cihaz
# "ZOMBIE" sanilip yeniden baslatiliyordu (sonsuz dongu, cihaz hic kalkamiyordu).
# Damga surecten BAGIMSIZ oldugu icin bu tuzagi kapatir.
date +%s > "/run/wd-boot-$INST" 2>/dev/null || true

# ★★★2026-08-18 GOZCU (fonksiyon). Iki yerden cagrilir:
#   (a) normal kurulum sonunda,
#   (b) "zaten calisiyor" yolunda — eskiden orada `exit 0` vardi ve GOZCUYU OLDURUYORDU.
# Container olurse ya da icerideki Android cevapsizlasirsa `exit 1` -> systemd
# `Restart=on-failure` ile cihazi ~70 sn'de kendi kaldirir.
# ★★★2026-08-19 pgrep MALIYETI — gozcu tek basina ~3.1 CEKIRDEK yiyordu.
# `pgrep -f` TUM /proc'u tarar ve her surecin cmdline'ini okur. Bu makinede
# 14.198 surec / 153.424 thread var -> her cagri ~14 bin dosya okumasi. Gozcu
# 140 cihazda 30 sn'de bir cagiriyordu = saniyede ~66 bin okuma.
# OLCUM (top -bn2, surec adina toplam): pgrep 306.8% = ~3.1 cekirdek.
# (Kiyas: com.whatsapp 679%, surfaceflinger 426% — bunlar kacinilmaz, pgrep DEGIL.)
# FIX: pid onbellege alinir, /proc/<pid>/cmdline DOGRUDAN okunur (TEK dosya).
# Tam tarama yalnizca onbellekteki pid oldugunde yapilir; davranis AYNI.
# ⚠`tr` KULLANMA: NUL karakterini kabuk argumaninda tasiyamazsin (onceki yama
# dosyaya gercek 0x00 yazdi ve kontrol her zaman basarisiz olurdu). `grep -a`
# NUL iceren cmdline dosyasini dogrudan okur.
_wd_lxc_pid=""
wd_lxc_alive() {
  if [ -n "$_wd_lxc_pid" ] && grep -aq "waydroid\.$INST/lxc" "/proc/$_wd_lxc_pid/cmdline" 2>/dev/null; then
    return 0
  fi
  _wd_lxc_pid=$(pgrep -f "waydroid\.$INST/lxc" 2>/dev/null | head -1)
  [ -n "$_wd_lxc_pid" ]
}
wd_watchdog_loop() {
  echo "WATCHDOG_START $INST"
  local _miss=0 _dead=0 _ip
  while :; do
    sleep 30
    if ! wd_lxc_alive; then
      # (1) Container SURECI yok — kesin olum.
      _miss=$((_miss + 1)); _dead=0
      # 2 ust uste kacirma (60 sn) = gercekten olmus; tek seferlik yarislara takilma
      if [ "$_miss" -ge 2 ]; then
        echo "CONTAINER_DIED $INST — servis basarisiz biriliyor, systemd yeniden baslatacak"
        exit 1
      fi
      continue
    fi
    _miss=0
    # (2) ZOMBIE: surec YASIYOR ama Android OLMUS olabilir. Eski gozcu yalnizca
    # pgrep'e bakiyordu ve bu durumu HIC goremiyordu (canli: mi277/mi290).
    # ⚠️Esik GENIS (6 x 30sn = 3 dk): "saglam cihazi zombie sanmak" daha once
    # filoyu 140->133 dusurmustu; anlik ADB doygunlugu tetiklememeli.
    _ip=$(cat "/var/lib/misc/dnsmasq.waydroid-$INST.leases" 2>/dev/null \
          | awk '$2 != "00:16:3e:f9:d3:03" && $3 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print $3}' | tail -1)
    if [ -z "$_ip" ]; then _dead=0; continue; fi   # IP bilinmiyorsa KARAR VERME
    if timeout 4 bash -c "echo > /dev/tcp/$_ip/5555" 2>/dev/null; then
      _dead=0
    else
      _dead=$((_dead + 1))
      if [ "$_dead" -ge 6 ]; then
        echo "CONTAINER_ZOMBIE $INST — surec yasiyor ama ADB 3 dk cevapsiz ($_ip:5555); yeniden baslatiliyor"
        exit 1
      fi
    fi
  done
}
# ★2026-08-12 GUVENLIK: instance adini KAPIDA dogrula. Bu betikte $INST 23 yerde,
# cogunlukla TIRNAKSIZ kullaniliyor (ornegin satir ~17: `rm -rf /run/wd-$INST`).
# Deger API'den geliyor ve orada icerik denetimi YOK (`metadata: z.unknown()`),
# agent ise `execFile('bash', [script, INST])` ile cagiriyor: argv guvenli gelir
# ama betigin ICINDE tirnaksiz genisleme yeniden kelime ayristirmasi yapar —
# `INST="x /"` degeri `rm -rf /run/wd-x /` haline gelir, yani KOK SILME.
# 23 kullanimi tek tek tirnaklamak yerine (regresyon riski) girdiyi burada
# reddediyoruz; wd-destroy.sh ayni korumayi zaten uyguluyor, deseni birebir ayni.
case "$INST" in
  ''|*[!A-Za-z0-9_-]*) echo "wd-run: REDDEDILDI — gecersiz instance adi: '$INST'" >&2; exit 1;;
esac
# ★★★2026-08-14 MUKERRER-BASLATMA KILIDI — SUNUCUYU COKERTEN SEYIN KORUMASI.
#
# Bu betigin AYNI instance icin ikinci kez calismasi felakete yol aciyor: iki
# sarmalayici ayni container'i yonetmeye calisiyor, ust uste biniyor ve her tur
# bir kopya daha ekliyor.
# CANLI FELAKET (14 Agu): dns-heal eski wd-run'i oldurmeden yenisini baslatti ->
# 617 wd-run (155 olmali) -> 398 surec D-state'te kilitlendi -> `kill -9` bile
# ise yaramadi -> SUNUCU REBOOT gerekti, tum filo durdu, panel "0 cevrimici".
#
# `flock` ile tek-ornek garantisi: kilit alinamiyorsa ZATEN calisan bir kopya
# var demektir, sessizce cik. Kilit surec olunce kernel tarafindan otomatik
# birakilir (asili kalmaz). -n = bekleme, anında vazgec.
exec 9>"/run/wd-run-$INST.lock"
if ! flock -n 9; then
  # ★2026-08-15: kilit alinamadi -- ama bu HER ZAMAN "zaten calisiyor" demek DEGIL.
  # FD 9'u miras alan uzun omurlu cocukler (dbus-daemon vb.) wd-run ciktiktan sonra
  # da kilidi tutuyor -> OLU KILIT. Canli: mi112/mi114/mi261 kilidi dbus-daemon
  # tutuyordu, wd-run sureci YOKTU, cihazlar gece boyunca hic acilamadi.
  # Bu yuzden kilide DEGIL, container'in gercekten calisip calismadigina bakiyoruz.
  # Olcum ucuz: bridge'in uye arayuzu var mi (sadece /sys; /proc TARAMASI YOK).
  # ★★★2026-08-17: BRIDGE TEK BASINA YETMEZ — ZOMBIE'yi CANLI gosteriyordu.
  # CANLI KANIT: mi49 brif=[veth8MAaxW] lxc=VAR ama ping YOK; mi100 ayni. veth,
  # Android icerde OLDUGUNDE bile ayakta kaliyor -> wd-run "calisiyor" deyip cikiyor,
  # `systemctl restart` HICBIR SEY yapmiyor, cihaz sonsuza kadar olu kaliyor
  # (10 cihaz bu dongudeydi; ancak veth elle silinince kalktilar).
  # Bu yuzden bridge'e EK olarak Android'in cevap verdigini de dogruluyoruz:
  # container'in lxc-start sureci var mi VE ADB portu (5555) dinleniyor mu.
  # Ikisi de ucuz (/sys + ss); /proc TARAMASI YOK.
  _brif_dolu=""; [ -n "$(ls -A "/sys/class/net/waydroid-$INST/brif" 2>/dev/null)" ] && _brif_dolu=1
  _lxc_var=""; pgrep -f "waydroid\.$INST/lxc" >/dev/null 2>&1 && _lxc_var=1
  # ★★★2026-08-17 (DUZELTME) CANLILIK TESTI ARTIK GERCEK IP + GERCEK PORT.
  # ONCEKI HALI YANLIS POZITIF VERIYORDU: `ss ... dst <subnet>/24` o subnet'e ait
  # HERHANGI bir bayat baglantiyi sayiyor, yedek test de yine ".112" deniyordu.
  # Sonuc: olu cihaz "calisiyor" sanilip ATLANIYOR, health-watch "baslatiliyor" dese
  # bile wd-run hemen cikiyordu (canli: mi35 iki tur ust uste kalkmadi).
  _dev_ip=$(timeout 6 lxc-attach -n waydroid -P "/var/lib/waydroid.$INST/lxc" -- /system/bin/ip -4 -o addr show eth0 2>/dev/null \
            | awk '{print $4}' | cut -d/ -f1 | head -1)
  if [ -z "$_dev_ip" ]; then
    _dev_ip=$(cat "/var/lib/misc/dnsmasq.waydroid-$INST.leases" 2>/dev/null \
              | awk '$2 != "00:16:3e:f9:d3:03" && $3 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print $3}' | tail -1)
  fi
  _adb_canli=""
  if [ -n "$_dev_ip" ]; then
    timeout 3 bash -c "echo > /dev/tcp/$_dev_ip/5555" 2>/dev/null && _adb_canli=1
  fi
  if [ -n "$_brif_dolu" ] && [ -n "$_lxc_var" ] && [ -n "$_adb_canli" ]; then
    # ★★★2026-08-18 ARTIK `exit 0` YOK — GOZETIM DEVRALINIYOR.
    # Eskiden burada cikiliyordu; systemd Type=simple oldugu icin bu cagri, gozcu
    # dongusunu calistiran ESKI sureci degistirip aninda sonlandiriyordu ->
    # servis `active/exited` kaliyor, ORTADA GOZCU KALMIYORDU (canli: mi14/mi277/mi290).
    # Container saglam, yeniden KURULMUYOR; yalnizca gozetimi ustleniyoruz.
    echo "wd-run: $INST zaten calisiyor — yeniden kurulmadi, GOZETIM devralindi" >&2
    wd_watchdog_loop
  fi
  if [ -n "$_brif_dolu" ] && [ -z "$_adb_canli" ]; then
    echo "wd-run: $INST ZOMBIE (bridge var ama ADB cevapsiz) — temizlenip yeniden baslatiliyor" >&2
    lxc-stop -P "/var/lib/waydroid.$INST/lxc" -n waydroid -k >/dev/null 2>&1
    pgrep -f "waydroid\.$INST/lxc" | xargs -r kill -9 >/dev/null 2>&1
    for _v in $(ls -A "/sys/class/net/waydroid-$INST/brif" 2>/dev/null); do
      ip link delete "$_v" >/dev/null 2>&1
    done
    sleep 2
  fi
  echo "wd-run: $INST kilidi OLU (container yok) — kilit yok sayilip devam ediliyor" >&2
fi

exec >> /var/log/wd-$INST-run.log 2>&1
set -x
XRD=/run/xdg-$INST
MI=/opt/waydroid-mi2
LXCP=/var/lib/waydroid.$INST/lxc
export PYTHONPATH=$MI
SUBNET=$(sh /opt/fleet-agent/waydroid/net-head.sh $INST)

# 1 temizle
# ★★★2026-08-14 `pkill -f "instance $INST"` KENDI KILIDINI OLDURUYORDU.
# Bu kalip, calisan ONCEKI wd-run.sh surecinin KENDISINI de yakaliyor (komut
# satirinda instance adi geciyor). Kilit sahibi olunce kernel kilidi birakiyor ve
# ikinci cagri rahatca giriyordu -> flock korumasi ETKISIZ kaliyordu.
# CANLI TEST: kilit izole olarak KUSURSUZ calisti (1 aldi, 2-3 atlandi) ama
# wd-run.sh icinde 3 kopya olustu -> fark bu satirdan cikti.
# FIX: kendi PID'imizi (ve ust surecimizi) HARIC tut.
_self=$$; _ppid=$(ps -o ppid= -p $$ 2>/dev/null | tr -d ' ')
# ★★★2026-09-03 ONEK ESLESMESI — AYNI AILENIN 5. KOPYASI, BASLATMA YOLUNDA.
# `wayland-$INST`, `instance $INST`, `dnsmasq.*waydroid-$INST` desenleri CAPASIZDI:
# mi18 baslarken mi180-189'un weston'unu, session daemon'unu ve DHCP dnsmasq'ini
# olduruyordu. 3 Eyl 06:55'te 144 konteyner ayni anda basladiginda bu satirlar
# komsularin DHCP'sini kesti ("GERCEK DHCP lease YOK", "eth0 IPv4 yok" alarmlari).
# ($|[^0-9]) ile capalandi. ⚠️Bu deseni ANCHOR'SUZ birakma.
pkill -9 -f "wayland-$INST($|[^0-9])" 2>/dev/null
for _p in $(pgrep -f "instance $INST($|[^0-9])" 2>/dev/null); do
  [ "$_p" = "$_self" ] && continue
  [ "$_p" = "${_ppid:-0}" ] && continue
  kill -9 "$_p" 2>/dev/null
done
rm -rf /run/wd-$INST /run/xdg-$INST 2>/dev/null; sleep 1
# netfix: stale network_up marker bridge yeniden kurulmasini engeller (KOK NEDEN)
rm -f /run/waydroid-$INST-lxc/network_up 2>/dev/null  # netfix
pkill -9 -f "dnsmasq.*waydroid-$INST($|[^0-9])" 2>/dev/null  # netfix orphan-dnsmasq (subnet cakismasi onler) — ★2026-09-03 capalandi (mi18 → mi180-189 DHCP'sini olduruyordu)
touch /var/lib/waydroid-subnets.map 2>/dev/null; chmod 666 /var/lib/waydroid-subnets.map 2>/dev/null  # netfix
# ★2026-07-28 LEASE-TOHUMLAMA (.112 GARANTI): sistemin HER yeri cihaz IP'sini
# 192.168.<sub>.112 varsayar (serial, heal, teshis komutlari). Ama dnsmasq adresi
# havuzdan secer ve .113 verebilir (CANLI: mi13/mi12/mi14/mi19 .113 aldi -> ADB .112'yi
# aradigi icin cihaz "offline" gorundu). dnsmasq ACILISTA mevcut lease'i onurlandirir:
# lease dosyasi BOS/YOK ise .112'yi onceden yaz -> cihaz GERCEK DHCP ile .112 alir
# (DHCP sarttir; DNS'i yalnizca DHCP getirir — bkz. wd-firewall-dhcp.sh).
# Dolu lease'e DOKUNMA (calisan cihazin IP'sini degistirme).
_SUB=$(sh /opt/fleet-agent/waydroid/net-head.sh "$INST" 2>/dev/null)
# ★★★2026-08-13 SUBNET -> IP ONEKI (238 tavani kaldirildi, bkz. net-head.sh).
# S <= 239 -> 192.168.<S>   (mevcut 140 cihaz AYNEN kalir)
# S >= 240 -> 10.10.<S-239> (yeni blok; host'un 10.0.0.0/24'u ve docker 172.17 ile
#             cakismaz — canli olarak dogrulandi)
subnet_prefix() {
  if [ "$1" -le 239 ]; then echo "192.168.$1"; else echo "10.10.$(($1 - 239))"; fi
}
_PFX=""
[ -n "$_SUB" ] && _PFX=$(subnet_prefix "$_SUB")
_LEASE=/var/lib/misc/dnsmasq.waydroid-$INST.leases
# ★★★2026-08-17 LEASE TOHUMLAMASI KALDIRILDI — MAC UYUSMADIGI ICIN ISE YARAMIYORDU.
# Tohum SABIT bir MAC (00:16:3e:f9:d3:03) ile yaziliyordu, ama fingerprint sistemi
# her cihaza RASTGELE MAC veriyor. dnsmasq lease'i MAC'e gore esler -> tohum HIC
# kullanilmadi; cihaz havuzdan rastgele IP aldi (CANLI: 665 DHCPACK'in HEPSI .112 DISI).
# Geride yalnizca yanlis IP'li olu bir lease satiri kaliyor ve teshisi zorlastiriyordu.
# Artik tohum YAZILMIYOR; IP asagida GERCEK degerden okunuyor (bkz. GERCEK IP TESPITI).
:
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
# ★2026-08-13: onek subnet_prefix'ten gelir (S>=240 -> 10.10.x). Eski cihazlar
# (S<=239) icin sonuc birebir ayni: "192.168.<S>".
_NPFX=$(subnet_prefix "$SUBNET")
GW="$_NPFX.1"
# ★★★2026-08-17 GERCEK IP TESPITI — ".112 VARSAYIMI" BOOT'U OLDURUYORDU.
# ESKI: IP="$_NPFX.112" (SABIT varsayim). Cihaz DHCP'den .13/.55/.235 gibi BASKA bir
# adres alinca wd-run yanlis IP'ye ip/route yaziyor -> netfix_try 14 tur bosuna doner
# -> "NET_READY ok=0 tries=14" -> boot yarim kalir -> Terminated (19 cihaz "Durduruldu").
# YENI SIRA: (1) container eth0'daki GERCEK IP  (2) lease dosyasindaki gercek satir
#            (3) hicbiri yoksa eski .112 davranisi (geriye donuk guvenli fallback).
_realip=$(timeout 8 lxc-attach -n waydroid -P "$LXCP" -- ip -4 -o addr show eth0 2>/dev/null \
          | awk '{print $4}' | cut -d/ -f1 | head -1)
if [ -z "$_realip" ] && [ -s "$_LEASE" ]; then
  # tohum satirini (Pixel-8-Pro / sabit MAC) ELE, gercek kiralamayi al
  _realip=$(awk '$2 != "00:16:3e:f9:d3:03" {print $3}' "$_LEASE" 2>/dev/null | tail -1)
fi
case "$_realip" in
  [0-9]*.[0-9]*.[0-9]*.[0-9]*) IP="$_realip" ;;
  *) IP="$_NPFX.112" ;;
esac
echo "REAL_IP $INST ip=$IP (varsayim .112 DEGIL)"
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
    timeout 8 lxc-attach -n waydroid -P $LXCP -- ip route add $_NPFX.0/24 dev eth0 proto static scope link src $IP table $T 2>/dev/null
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
# ★★★2026-08-17 GOZCU DONGUSU — ESKIDEN BURADA `sleep infinity` VARDI.
# Sorun: container SONRADAN olse bile `sleep infinity` yasiyordu -> systemd birimi
# "active" kaliyor -> Restart=on-failure HIC tetiklenmiyor, `systemctl start` de
# NO-OP oluyordu -> olen cihaz KENDILIGINDEN BIR DAHA KALKMIYORDU (canli: 20 cihaza
# `start` -> 94'te kaldi; `restart` -> 118'e cikti; mi100/mi102/mi105 4+ saat olu).
# Artik container'i gozetliyoruz: olurse exit 1 -> systemd FAILED gorur ->
# Restart=on-failure devreye girer -> cihaz ~10 sn'de otomatik kalkar.
# Olcum ucuz: pgrep (tek arama), /proc TARAMASI YOK (bkz. proc-taramasi kilidi dersi).
wd_watchdog_loop
