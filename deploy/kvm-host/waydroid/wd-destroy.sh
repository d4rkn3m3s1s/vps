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

# 2) Disable + remove the per-instance systemd unit.
if [ -f "$UNIT" ]; then
  systemctl disable --now "waydroid-$INSTANCE.service" >/dev/null 2>&1 || true
  rm -f "$UNIT" && log "systemd unit removed"
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

log "destroyed"
echo "DESTROY_RESULT instance=$INSTANCE status=destroyed"
