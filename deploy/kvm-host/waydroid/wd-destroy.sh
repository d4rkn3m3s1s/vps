#!/bin/bash
# wd-destroy.sh <instance> — fully remove a Waydroid instance and reclaim its disk.
# Used to clean up a half-built instance after a FAILED provision — otherwise the instance
# dir (~2.3GB under /var/lib/waydroid.<inst>) + its userdata, systemd unit, dbus policy and
# subnet-map line leak permanently, since nothing else ever removes them. Also invocable by
# the operator "delete device" / cancel path.
#
# Removes: the container (via wd-stop), the instance's /var/lib/waydroid.<inst> tree, its
# userdata (/root/.local/share/waydroid.<inst>), its systemd unit, its D-Bus policy, and
# its subnet-map line. (The live wd-provision uses a SHARED GApps image via `init -i`, so
# there's no separate multi-GB userdata clone — just these instance-scoped paths.)
#
# ★INVARIANT (matches wd-provision.sh's warning): does NOT delete the shared waydroid
# bridge — waydroid-net.sh creates it once and won't recreate it if removed, which would
# break EVERY subsequent provision. We only stop THIS instance's session, never the bridge.
#
# Idempotent + defensive: every step is best-effort so a partially-provisioned instance
# (any subset of these paths present) is cleaned without erroring. Refuses empty/unsafe
# names so a bad arg can never `rm -rf` a wrong path.
set -u
INSTANCE="${1:?instance name required}"
# Guard: only [A-Za-z0-9_-], non-empty, not a path — never let a stray value nuke /var/lib.
case "$INSTANCE" in
  ''|*[!A-Za-z0-9_-]*) echo "DESTROY_RESULT instance=$INSTANCE status=refused reason=bad_name"; exit 1;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="/var/lib/waydroid.$INSTANCE"
# ★VERIFIED against the LIVE host layout: userdata lives at share/waydroid.<inst>
# (NOT share-<inst>). The live wd-provision.sh uses `waydroid.py init -i` with a SHARED
# GApps image, so there is no separate ~4GB userdata clone to remove — just this dir.
DATA_HOME="/root/.local/share/waydroid.$INSTANCE"
UNIT="/etc/systemd/system/waydroid-$INSTANCE.service"
DBUS_CONF="/usr/share/dbus-1/system.d/id.waydro.Container.$INSTANCE.conf"
LEASES="/var/lib/misc/dnsmasq.waydroid-$INSTANCE.leases"
SUBNET_MAP="/var/lib/waydroid-subnets.map"

log(){ echo "[wd-destroy:$INSTANCE] $*"; }

# 1) Stop the session/container first (reuse wd-stop's scoped teardown).
if [ -x "$HERE/wd-stop.sh" ]; then
  bash "$HERE/wd-stop.sh" "$INSTANCE" >/dev/null 2>&1 || true
  log "session stopped"
fi

# 1b) ★2026-07-24: wd-stop tears down the Waydroid SESSION but leaves the per-instance
# SUPERVISOR + sidecars running: the wd-run.sh shell, its session dbus-daemon (xdg-<inst>),
# the per-instance redsocks proxy daemon, and any lingering weston (wayland-<inst>). VERIFIED
# LIVE: after deleting watest56 these 3-4 processes kept running (redsocks holding a proxy
# port, wd-run shell + dbus). Kill them by their instance-scoped patterns so "destroy" really
# frees everything. Patterns are anchored to THIS instance name (guarded [A-Za-z0-9_-] above),
# so they can't match another instance. Best-effort; SIGTERM then SIGKILL for stragglers.
# ★★★2026-08-18 ONEK ESLESMESI DUZELTILDI — komsu cihazlari olduruyordu.
# `pkill -f "wd-run.sh mi18"` deseni mi180..mi189'u DA oldururdu (sonu bagli degil).
# CANLI: mi18/mi30/mi9 silinince 20 cihaz dustu (mi180-189, mi300-309, mi90-98).
# Instance adlari mi<rakam> oldugundan catisma yalnizca "sonuna rakam eklenmis"
# adlarla olur; ($|[^0-9]) bunu tam keser. ⚠️Bu deseni ANCHOR'SUZ birakma.
_A='($|[^0-9])'
for pat in "wd-run\.sh $INSTANCE$_A" "xdg-$INSTANCE/bus" "redsocks-inst-$INSTANCE\.conf" "wayland-$INSTANCE$_A"; do
  pkill -f "$pat" 2>/dev/null || true
done
sleep 1
for pat in "wd-run\.sh $INSTANCE$_A" "xdg-$INSTANCE/bus" "redsocks-inst-$INSTANCE\.conf" "wayland-$INSTANCE$_A"; do
  pkill -9 -f "$pat" 2>/dev/null || true
done
# Remove this instance's redsocks config (else /etc fills with dead per-instance confs).
rm -f "/etc/redsocks-inst-$INSTANCE.conf" 2>/dev/null || true

# ★2026-07-27 KOK-FIX (binderfs LEAK): /dev/binderfs-<inst> mount'u SILINMIYORDU →
# eski/bozuk binderfs kalintisi kaliyordu → sonraki AYNI-slot kurulumu bu bozuk mount'a
# baglaniyor → Android boot olur ama binder "has died" → boot COKME (mi29 canli kanit:
# 69s->150s-timeout). Cozum: binderfs'i lazy-umount (kullanimda olsa bile) + node symlink
# + mount-dizini temizle. Boylece slot GERCEKTEN bosalir, sonraki kurulum temiz binderfs kurar.
umount -l "/dev/binderfs-$INSTANCE" 2>/dev/null || true
umount -f "/dev/binderfs-$INSTANCE" 2>/dev/null || true
rm -rf "/dev/binderfs-$INSTANCE" 2>/dev/null || true
rm -f "/dev/anbox-binder-$INSTANCE" "/dev/anbox-hwbinder-$INSTANCE" "/dev/anbox-vndbinder-$INSTANCE" "/dev/hwbinder-$INSTANCE" "/dev/vndbinder-$INSTANCE" "/dev/binder-$INSTANCE" 2>/dev/null || true
log "binderfs unmount + binder nodes cleared (leak-fix)"
log "supervisor + redsocks + dbus sidecars killed"

# 2) Disable + remove the systemd unit.
# ★★★2026-08-20 KOK DUZELTME — DISABLE HIC CALISMIYORDU.
# Bu blogun TAMAMI `if [ -f "$UNIT" ]` icindeydi ve
#   UNIT=/etc/systemd/system/waydroid-<inst>.service   (TIRE)
# yani cihaz basina bir birim DOSYASI bekliyordu. Oysa bu filo SABLON birim
# kullaniyor; gercek etkinlestirme su symlink'tir:
#   /etc/systemd/system/multi-user.target.wants/waydroid@<inst>.service
# Tire'li dosya HIC var olmadi -> kosul DAIMA yanlis -> `systemctl disable`
# bir kez bile calismadi.
# ⚠️Bu, ayni ailenin DORDUNCU kopyasi: 20 Agu'de birim ADI duzeltilmisti ama ad,
# CALISMAYAN bir blogun icindeydi; duzeltme bu yuzden etkisiz kaldi.
# CANLI KANIT: mi434 + mi440 silindi (DB kaydi gitti, veri dizinleri 8KB'ye
# dustu) ama birimleri ETKIN kaldi. Iki ayri zarar:
#   1) reboot'ta systemd artik VAR OLMAYAN cihazlari baslatmaya calisir,
#   2) ajanin dns-heal'i de onlari surekli diriltmeye ugrasiyordu (16:53/17:03).
# ARTIK KOSULSUZ: birim zaten etkin degilse `disable` zararsiz bir no-op'tur.
systemctl disable --now "waydroid@$INSTANCE.service" >/dev/null 2>&1 || true
systemctl reset-failed "waydroid@$INSTANCE.service" >/dev/null 2>&1 || true
rm -f "/etc/systemd/system/multi-user.target.wants/waydroid@$INSTANCE.service" 2>/dev/null || true
log "systemd birimi kapatildi (waydroid@$INSTANCE.service)"
# Eski kurulumlardan kalan CIHAZ BASINA birim dosyasi varsa o da temizlensin.
if [ -f "$UNIT" ]; then
  systemctl disable --now "waydroid-$INSTANCE.service" >/dev/null 2>&1 || true
  rm -f "$UNIT" && log "eski tarz birim dosyasi silindi"
fi

# 3) Remove the D-Bus own policy + reload so the bus forgets the name.
if [ -f "$DBUS_CONF" ]; then
  rm -f "$DBUS_CONF" && log "dbus policy removed"
  systemctl reload dbus >/dev/null 2>&1 || true
fi

# 4) Remove the instance's on-disk trees (the big ones — ~4.4GB). rm -rf is bounded to
#    the instance-scoped paths validated above; nothing else is touched.
[ -d "$WORK" ]      && rm -rf "$WORK"      && log "removed $WORK (images/lxc/overlay)"
[ -d "$DATA_HOME" ] && rm -rf "$DATA_HOME" && log "removed $DATA_HOME (userdata ~2GB)"
rm -f "$LEASES" 2>/dev/null || true

# 4b) ★★★2026-08-20 IPTABLES NAT KURALLARINI TEMIZLE.
# wd-destroy bugune kadar iptables'a HIC dokunmuyordu (`grep -c iptables` = 0).
# Her silinen cihaz PREROUTING'de kendi subnet'ine ait RETURN + REDIRECT
# satirlarini geride birakiyordu. CANLI OLCUM: 139 cihaz varken 141 REDIRECT
# (silinen mi434=subnet143, mi440=subnet41 kalintisi).
# Kalici hasar DEGIL — kurallar reboot'ta silinip `wd-proxy-restore` ile yeniden
# kuruluyor ve port subnet'ten turedigi icin (12500+sn) ayni subnet'i alan yeni
# cihaz dogru kurala duser. Yine de iki reboot arasinda birikiyor; olu kural
# birakmak dogru degil.
# GUVENLIK: yalnizca SAYISAL ve 1-254 arasindaki subnet icin, yalnizca O subnet'in
# kendi satirlari silinir. Subnet-map satiri (5) ADIMINDA silindigi icin numarayi
# BURADA, silinmeden ONCE okuyoruz.
# ⚠️TAM YOL: systemd ortaminda PATH /usr/sbin icermeyebilir (bu projede
#   "container-ici `ip` HIC calismiyordu" ayni kokten cikmisti).
_IPT="$(command -v iptables 2>/dev/null || echo /usr/sbin/iptables)"
_SN=$(grep -E "^$INSTANCE[[:space:]]" "$SUBNET_MAP" 2>/dev/null | awk '{print $2}' | head -1)
case "$_SN" in
  ''|*[!0-9]*)
    log "iptables temizligi atlandi (subnet okunamadi)"
    ;;
  *)
    if [ "$_SN" -ge 1 ] && [ "$_SN" -le 254 ] && [ -x "$_IPT" ]; then
      _rf="/tmp/wd-ipt-$INSTANCE-$$.rules"
      # `-A` -> `-D` cevirip AYNI kurali sil. Pipeline yerine dosya kullaniyoruz:
      # `while read` bir pipeline icinde ALT KABUKTA calisir ve sayac kaybolur.
      "$_IPT" -t nat -S PREROUTING 2>/dev/null \
        | grep -F -- "-s 192.168.${_SN}.0/24" \
        | sed 's/^-A /-D /' > "$_rf" 2>/dev/null || true
      _n=0
      if [ -s "$_rf" ]; then
        while IFS= read -r _r; do
          [ -n "$_r" ] || continue
          # shellcheck disable=SC2086  # kural sozcuklere BOLUNMELI
          "$_IPT" -t nat $_r 2>/dev/null && _n=$((_n+1))
        done < "$_rf"
      fi
      rm -f "$_rf" 2>/dev/null || true
      log "iptables NAT kurallari temizlendi (subnet $_SN, $_n kural)"
      # ★2026-08-22 FORWARD (filter) kurallarini da temizle.
      # nat/PREROUTING yukarida temizleniyor ama kill-switch kurallari filter/FORWARD'da:
      #   -s <subnet> -p tcp -j DROP   (sizinti kill-switch, 22 Agu)
      #   -s <subnet> -p udp ! --dport 53 -j DROP  (QUIC sizinti kapatma, 24 Tem)
      # Silinen cihazda birakilirsa birikirler; subnet yeniden kullanildiginda da
      # cift kayit olusur. Idempotent: eslesen TUM kopyalar dusene kadar sil.
      _fn=0
      while "$_IPT" -C FORWARD -s "192.168.${_SN}.0/24" -p tcp -j DROP 2>/dev/null; do
        "$_IPT" -D FORWARD -s "192.168.${_SN}.0/24" -p tcp -j DROP 2>/dev/null || break
        _fn=$((_fn+1))
      done
      while "$_IPT" -C FORWARD -s "192.168.${_SN}.0/24" -p udp ! --dport 53 -j DROP 2>/dev/null; do
        "$_IPT" -D FORWARD -s "192.168.${_SN}.0/24" -p udp ! --dport 53 -j DROP 2>/dev/null || break
        _fn=$((_fn+1))
      done
      log "FORWARD kurallari temizlendi (subnet $_SN, $_fn kural)"
    else
      log "iptables temizligi atlandi (subnet=$_SN, ipt=$_IPT)"
    fi
    ;;
esac

# 5) Free the subnet-map line so net-head.sh can reuse the subnet (else the range
#    slowly fills with dead entries from failed provisions and eventually runs out).
#
# ★★★2026-08-13 KAYBOLAN GÜNCELLEME YARIŞI — TOPLU SİLMEDE HİÇBİR SATIR SİLİNMİYORDU.
#
# Blok "oku → süz → geri yaz" yapıyor ama KİLİTSİZDİ. Operatör panelden birden çok
# cihazı birden silince agent 11 DEVICE_DESTROY işini AYNI ANDA koşturuyor; 11 süreç
# haritayı aynı anda okuyup yazınca son yazan diğer 10'un silmesini EZİYOR.
#
# CANLI KANIT (13 Ağu 01:33:45–46, 11 destroy işi paralel):
#   toplu silinen 11 cihaz → 11/11 HARİTADA KALDI
#   tek tek silinenler (mi287, mi284) → 0/2 kaldı (temizlendi) ✓
#   wd-destroy kilidi: 0 referans   ·   net-head.sh kilidi: 3 referans
# Sonuç: 16 hayalet kayıt subnet tutuyordu (boş subnet 93 → 67'ye düşmüştü).
#
# FIX: net-head.sh'in KULLANDIĞI AYNI kilidi (mkdir tabanlı, flock'suz — betik `sh`
# ile de çalışabiliyor) burada da al. Aynı kilit olması ŞART: net-head TAHSİS ederken
# biz SİLERSEK aynı yarış tahsis tarafında da oluşur.
if [ -f "$SUBNET_MAP" ]; then
  _LOCKD=/var/lib/waydroid-subnets.lock
  _i=0
  while ! mkdir "$_LOCKD" 2>/dev/null; do
    _i=$((_i+1))
    # 50 tur × 0.1s = 5s. Kilit sahibi çökmüşse bekleyip yine de devam et (silme
    # kaybolabilir ama SİLME İŞİNİ BLOKLAMAK daha kötü — cihaz zaten yok edildi).
    [ "$_i" -gt 50 ] && { log "subnet-map kilidi alinamadi (5s) — yine de deneniyor"; break; }
    sleep 0.1
  done
  # Lines look like "<instance> <subnetId>"; drop the one for THIS instance.
  tmp="$(mktemp 2>/dev/null || echo "$SUBNET_MAP.tmp")"
  grep -vE "^$INSTANCE([[:space:]]|$)" "$SUBNET_MAP" > "$tmp" 2>/dev/null && cat "$tmp" > "$SUBNET_MAP" 2>/dev/null || true
  rm -f "$tmp" 2>/dev/null || true
  rmdir "$_LOCKD" 2>/dev/null || true
  log "subnet-map entry freed"
fi

# 6) ★2026-08-04 İSİM MEZARLIĞI — silinen instance ADI bir daha ASLA kullanılmaz.
#    Operatör: "mi47'yi silersem bir daha kurulmasın, hep farklı olsun".
#    Sebep: numara geri dönerse eski cihazın izleri (bayat ADB ucu, dnsmasq lease,
#    ARP/route kaydı, WhatsApp'ın gördüğü cihaz kimliği) yeni cihaza karışır —
#    28 Tem'de "bayat ADB ucu kurulumu öldürür" olayının tam kaynağı budur.
#    ⚠️ SUBNET geri kazanılmaya DEVAM EDER (yukarıdaki blok): aralık 2..239 ile
#    sınırlı ve dolabilir. Geri dönmeyen tek şey İSİM.
GRAVEYARD="/var/lib/waydroid-retired.list"
if ! grep -qxF "$INSTANCE" "$GRAVEYARD" 2>/dev/null; then
  echo "$INSTANCE" >> "$GRAVEYARD" 2>/dev/null || true
  log "isim emekliye ayrildi (bir daha kullanilmayacak): $INSTANCE"
fi


# 7) ★★★2026-08-20 SAGLIK DAMGALARINI TEMIZLE (MEZAR TASI SORUNU).
#    Cihaz silinince /var/lib/wd-health/ altindaki durum damgalari GERIDE KALIYORDU.
#    Canli vaka: /durum sayfasi "su an dusuk: 15 cihaz" diyordu — 15'inin de HEPSI
#    coktan SILINMIS cihazlardi (9'unun dizini bile yoktu, damgalar 40-67 saatlik).
#    Filo 141/141 tam ayaktayken operator "15 cihaz dusuk" goruyordu.
#    Damgalar:
#      down-<inst>      : dusus ani (kurtarma suresi buradan sayilir)
#      zfail-<inst>     : zombie yoklama sayaci
#      bootstuck-<inst> : yarim-acilmis kurtarma sogumasi (2026-08-20)
for _st in down zfail bootstuck; do
  rm -f "/var/lib/wd-health/${_st}-${INSTANCE}" 2>/dev/null || true
done
log "saglik damgalari temizlendi (down/zfail/bootstuck)"

# 8) ★2026-08-20 CIHAZIN LOG DOSYALARINI TEMIZLE.
# /var/log/wd-<inst>-run.log ve -init.log silmede geride kaliyordu: 449 dosya /
# 267 MB ve bunlarin 308'i COKTAN SILINMIS cihazlara aitti. Ustelik logrotate
# kapsaminda da degillerdi (yalniz fleet-agent.log + redsocks*.log vardi) ->
# SINIRSIZ buyuyorlardi. Bu filoda log sismesi daha once yasandi (13 GB).
# Artik: (a) /etc/logrotate.d/fleet-wd tum wd-*.log'lari donduruyor (maxage 14),
#        (b) silme aninda o cihazin logu dogrudan kaldiriliyor.
# ⚠️Yol instance adiyla SINIRLI — komsu cihazin logu ASLA silinmez.
for _lg in "/var/log/wd-${INSTANCE}-run.log" "/var/log/wd-${INSTANCE}-init.log"; do
  [ -e "$_lg" ] && rm -f "$_lg" 2>/dev/null
done
rm -f "/var/log/wd-${INSTANCE}-run.log."* "/var/log/wd-${INSTANCE}-init.log."* 2>/dev/null || true
log "cihaz log dosyalari temizlendi"
log "destroyed"
echo "DESTROY_RESULT instance=$INSTANCE status=destroyed"
