#!/bin/bash
# wd-stop.sh <instance> — cleanly stop a running Waydroid instance without
# touching any other instance. Kills the session/container/compositor this
# instance owns and clears lingering mounts. Idempotent (safe if already down).
set -u
INSTANCE="${1:?instance name required}"
LXCP="/var/lib/waydroid.$INSTANCE/lxc"

log(){ echo "[wd-stop:$INSTANCE] $*"; }

# 1) stop the container (Android) — -k kills it immediately.
if lxc-info -P "$LXCP" -n waydroid -sH 2>/dev/null | grep -q RUNNING; then
  lxc-stop -P "$LXCP" -n waydroid -k 2>/dev/null && log "container stopped" || log "lxc-stop returned nonzero"
else
  log "container already stopped"
fi

# 2) kill this instance's session daemon + compositor (scoped by instance name so
#    we never hit another instance's processes).
# ★★★2026-08-20 ONEK ESLESMESI DUZELTILDI — komsu cihazlari olduruyordu.
# `--instance mi30` deseni `--instance mi300/mi304/...` hepsini yakaliyordu.
# CANLI KANIT: gercek `wd-destroy.sh mi30` testinde ADB 140->134 dustu,
# mi300-309 "7/7 running" -> 4/7 oldu; kuru sinamada desen 9 surec buluyordu.
# ⚠️wd-destroy ve wd-health-watch'teki ayni hata daha once duzeltilmisti,
# BU DOSYA GOZDEN KACMISTI (wd-destroy onu cagiriyor).
pkill -f "waydroid\.py --instance $INSTANCE($|[^0-9])" 2>/dev/null && log "session daemon killed" || true
pkill -f "weston .*--socket=wayland-$INSTANCE( |$)" 2>/dev/null && log "weston killed" || true

# 3) clear lingering bind mounts the container left behind (umount -l = lazy).
# ★★★2026-09-03 ONEK ESLESMESI — AYNI AILENIN 4. KOPYASI, BU KEZ MOUNT YOLUNDA.
# `awk '$3 ~ p'` REGEX alt-dizi eslesmesiydi: p="/var/lib/waydroid.mi18" deseni
# /var/lib/waydroid.mi180/rootfs, .mi181/..., .mi189/... mount'larini da yakalayip
# hepsini lazy-umount ediyordu. CANLI OLAY: orphan-reaper var olmayan mi18/mi27/mi29
# icin wd-destroy → wd-stop cagirdi; mi18x/mi27x/mi29x'in rootfs'i cekildi, 13
# konteyner ayni anda yeniden basladi → kernel 6.8 eventfs deadlock (101 init D).
# (Ayni hata 20 Agu'de satir 26'da duzeltilmisti; bu satir gozden kacmisti.)
# ANCHOR: yol ya TAM p'ye esit ya da p + "/" ile BASLAMALI.
for m in $(mount 2>/dev/null | awk -v p="/var/lib/waydroid.$INSTANCE" '($3 == p) || (index($3, p "/") == 1) {print $3}' | sort -r); do
  umount -l "$m" 2>/dev/null && log "unmounted $m" || true
done

log "stopped"
echo "STOP_RESULT instance=$INSTANCE status=stopped"
