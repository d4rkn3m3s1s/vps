#!/bin/bash
# wd-tracefs-guard.sh <instance> — konteynerin tracefs/debugfs'e DOKUNMASINI engeller.
#
# ★★★2026-09-03 KOK OLAY (Linux 6.8.0-138, eventfs deadlock):
# unattended-upgrade → dnsmasq/fleet-agent restart → 13 konteyner AYNI SANIYEDE
# yeniden basladi → her Android init `init.rc:82`'deki
#     mount tracefs tracefs /sys/kernel/tracing gid=3012
# satirini ve atrace.rc'nin /sys/kernel/{tracing,debug/tracing}/events/... altindaki
# 99 chmod'unu ayni anda kosturdu → cekirdegin eventfs kilidi
# (eventfs_root_lookup × eventfs_iterate × d_alloc_parallel × tracefs super_lock)
# KALICI kilitlendi → 101 init D-state, 7.5 saat, kill -9 gecmez, reboot'suz cikis yok.
# Kilit varken baslatilan HER yeni konteyner de ayni kuyruga giriyordu (yeni cihaz
# acilamiyor, silme lxc-stop'ta 180s timeout'a dusuyordu).
#
# Cekirdek yigini (kanit): super_lock ← grab_super ← sget ← mount_single ← trace_mount
#   ← trace_automount ← debugfs_automount ← __traverse_mounts ← walk_component
# Yani IKI KAPI var; ikisi de kapatilmali (tek biri yetmez — canli olcum, mi272):
#   1) init.rc'nin tracefs mount satiri            → overlay ile golgelenir
#   2) /sys/kernel/debug/tracing = debugfs AUTOMOUNT → LXC config_nodes'taki
#      `/sys/kernel/debug` rbind girdisi kaldirilir (konteynerin /sys'i taze sysfs;
#      tracing/debug BOS dizin olur, tum eriskimler ENOENT ile gecer)
#
# Android bunlarsiz ACILIR (host'ta tracing_on=0, current_tracer=nop → ftrace
# kullanilmiyor, kayip yok). Beklenen zararsiz loglar: `cutils-trace: Error opening
# trace file`, `GpuMem: Failed to attach bpf program` — boot'u etkilemez.
# CANLI KANIT: mi272 init D-state'ten cikti (S/ep_poll), zygote+system_server+
# surfaceflinger+netd ayaga kalkti.
#
# Idempotent: kac kez calisirsa calissin ayni sonuc. Calisan cihaza DOKUNMAZ —
# degisiklik yalnizca konteynerin SONRAKI baslatilmasinda okunur.
# config_nodes'u yalnizca `waydroid init/upgrade` yeniden uretir (lxc.py:100);
# `waydroid upgrade` calistirilirsa bu betik tekrar uygulanmali.
#
# Kullanim:  wd-tracefs-guard.sh <instance>        (wd-provision.sh init'ten sonra cagirir)
set -u
I="${1:?instance}"
case "$I" in ''|*[!A-Za-z0-9_-]*) echo "GUARD_RESULT instance=$I status=refused"; exit 1;; esac
W="/var/lib/waydroid.$I"
[ -d "$W" ] || { echo "GUARD_RESULT instance=$I status=no_instance"; exit 1; }
log(){ echo "[tracefs-guard:$I] $*"; }

# ── 1) init.rc overlay ──────────────────────────────────────────────────────────
# Kaynak: paylasimli imajin init.rc'si. Bu instance'in rootfs'i mount'lu degilse
# (yeni kurulum, henuz baslamamis) baska bir canli instance'in rootfs'inden okunur.
# sed desenleri idempotent — zaten yamali bir kopyaya uygulanirsa degismez.
SRC=""
for c in "$W/rootfs/system/etc/init/hw/init.rc" /var/lib/waydroid.mi*/rootfs/system/etc/init/hw/init.rc; do
  [ -s "$c" ] && { SRC="$c"; break; }
done
if [ -z "$SRC" ]; then
  log "UYARI: kaynak init.rc bulunamadi (hicbir rootfs mount'lu degil) — overlay atlandi"
else
  DST="$W/overlay/system/etc/init/hw/init.rc"
  mkdir -p "$(dirname "$DST")"
  TMP="$DST.tmp.$$"
  sed -e 's|^\(\s*\)mount tracefs tracefs /sys/kernel/tracing.*|\1# FLEET(tracefs-guard): tracefs mount KALDIRILDI — kernel 6.8 eventfs deadlock (2026-09-03)|' \
      -e 's|^\(\s*\)\(mkdir /sys/kernel/tracing/instances/bootreceiver.*\)|\1# FLEET(tracefs-guard): \2|' \
      -e 's|^\(\s*\)\(restorecon_recursive /sys/kernel/tracing/instances/bootreceiver.*\)|\1# FLEET(tracefs-guard): \2|' \
      -e 's|^\(\s*\)\(write /sys/kernel/tracing/instances/bootreceiver.*\)|\1# FLEET(tracefs-guard): \2|' \
      "$SRC" > "$TMP" && chmod 644 "$TMP" && mv -f "$TMP" "$DST"
  if grep -q '^\s*mount tracefs' "$DST"; then
    log "HATA: overlay init.rc'de tracefs mount hala aktif"; exit 1
  fi
  log "overlay init.rc yazildi ($(grep -c 'FLEET(tracefs-guard)' "$DST") satir kapatildi, kaynak=$(dirname "$SRC" | cut -d/ -f4))"
fi

# ── 2) LXC config_nodes: /sys/kernel/debug girdisini kapat ────────────────────
CN="$W/lxc/waydroid/config_nodes"
if [ -f "$CN" ]; then
  if grep -q '^lxc.mount.entry = /sys/kernel/debug ' "$CN"; then
    cp -a "$CN" "$CN.bak-tracefs-guard" 2>/dev/null || true
    sed -i 's|^\(lxc.mount.entry = /sys/kernel/debug .*\)|# FLEET(tracefs-guard, 2026-09-03 eventfs deadlock): \1|' "$CN"
  fi
  N=$(grep -c '^lxc.mount.entry = /sys/kernel/debug ' "$CN")
  [ "$N" = "0" ] || { log "HATA: config_nodes'ta debug girdisi hala aktif"; exit 1; }
  log "config_nodes: /sys/kernel/debug girdisi kapali"
else
  log "UYARI: $CN yok (init henuz calismamis?)"
fi

echo "GUARD_RESULT instance=$I status=ok"
