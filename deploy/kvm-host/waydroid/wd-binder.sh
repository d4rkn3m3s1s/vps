#!/bin/bash
# wd-binder.sh <instance> — ensure the isolated binder nodes for a Waydroid
# instance exist before its container starts. Idempotent. Runs as ExecStartPre.
# Creates /dev/binder-<inst>, /dev/vndbinder-<inst>, /dev/hwbinder-<inst> in a
# dedicated binderfs so the instance never shares binder with #1/#2/#3.
set -u
INSTANCE="${1:?instance name required}"
BFS="/dev/binderfs-$INSTANCE"
mkdir -p "$BFS"
mountpoint -q "$BFS" || mount -t binder binder "$BFS"

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
