#!/bin/bash
# wd-binder.sh <instance> — ensure the isolated binder nodes for a Waydroid
# instance exist before its container starts. Idempotent. Runs as ExecStartPre.
# Creates /dev/binder-<inst>, /dev/vndbinder-<inst>, /dev/hwbinder-<inst> in a
# dedicated binderfs so the instance never shares binder with #1/#2/#3.
set -u
INSTANCE="${1:?instance name required}"
BFS="/dev/binderfs-$INSTANCE"
mkdir -p "$BFS"
# ★★★2026-09-03 HER BASLATMADA TAZE binderfs — eski mount'u YENIDEN KULLANMA.
# Eskiden `mountpoint -q || mount` mevcut binderfs'i aynen kullaniyordu. Konteynerin
# onceki init'i cekirdek kilidinde (D-state, eventfs deadlock) kalip OLDURULEMEDIGINDE
# eski binder cihazlarina referansi surdu; yeni konteyner AYNI binderfs'i alinca
# binder islemleri olu surece gitti: dmesg "binder_linux: undelivered transaction,
# process died" + "binder_alloc_buf, no vma" (3 dk'da 352 satir). Belirti: Android
# acilir gibi olur, HAL'lar kayit olamaz, system_server `StartPowerStatsService`'te
# Watchdog WAITED_HALF ile asili kalir, boot_completed HIC gelmez.
# CANLI KANIT (mi272): ayni config ile eski binderfs → 3 deneme asili; lazy-umount +
# taze mount → 110 sn'de boot_completed=1, gercek DHCP IP, WhatsApp ayakta.
# Lazy umount guvenli: zombi/onceki sureclerin fd'leri kendi referansini korur,
# yeni mount ayri bir binder ornegidir (binderfs coklu mount destekler).
# Ayni mekanizma 27 Tem'deki "binderfs LEAK → binder has died → boot cokme"
# ailesini de restart yolunda kapatir (o gun yalniz wd-destroy'da duzeltilmisti).
if mountpoint -q "$BFS"; then
  umount -l "$BFS" 2>/dev/null || true
fi
rm -f "/dev/binder-$INSTANCE" "/dev/vndbinder-$INSTANCE" "/dev/hwbinder-$INSTANCE" \
      "/dev/anbox-binder-$INSTANCE" "/dev/anbox-vndbinder-$INSTANCE" "/dev/anbox-hwbinder-$INSTANCE" 2>/dev/null || true
mount -t binder binder "$BFS"

python3 - "$BFS" "$INSTANCE" <<'PY'
import fcntl, os, sys
bfs, inst = sys.argv[1], sys.argv[2]
def IOWR(t, nr, size):
    return (3 << 30) | (t << 8) | (nr << 0) | (size << 16)
BINDER_CTL_ADD = IOWR(ord('b'), 1, 264)
for base in ("binder", "vndbinder", "hwbinder"):
    node = f"{base}-{inst}"
    if os.path.exists("/dev/" + node):
        continue
    buf = bytearray(264)
    nm = node.encode()
    buf[0:len(nm)] = nm
    try:
        fd = os.open(bfs + "/binder-control", os.O_RDWR)
        fcntl.ioctl(fd, BINDER_CTL_ADD, buf, True)
        os.close(fd)
        src = bfs + "/" + node
        if os.path.exists(src) and not os.path.exists("/dev/" + node):
            os.symlink(src, "/dev/" + node)
        print(f"[wd-binder] created {node}")
    except FileExistsError:
        pass
    except Exception as e:
        print(f"[wd-binder] ERR {node}: {e}")
PY

# ── anbox-* alias symlinks ────────────────────────────────────────────────────
# The LXC config (config_nodes) binds the binder devices from /dev/anbox-<node>-<inst>
# (the legacy Waydroid naming), but the loop above creates /dev/<node>-<inst>. On a
# FRESH host boot these happened to line up, but after a host REBOOT the container
# failed to start with "Failed to mount /dev/anbox-binder-<inst> ... No such file or
# directory" (VERIFIED LIVE 2026-07-18 after the cgroup-v1 reboot: every instance
# stayed STOPPED). Create the anbox-* aliases so the config's mount entries resolve
# regardless of naming. Idempotent.
for b in binder vndbinder hwbinder; do
  if [ -e "/dev/$b-$INSTANCE" ] && [ ! -e "/dev/anbox-$b-$INSTANCE" ]; then
    ln -sf "$BFS/$b-$INSTANCE" "/dev/anbox-$b-$INSTANCE"
  fi
done
