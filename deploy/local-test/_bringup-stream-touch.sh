#!/usr/bin/env bash
# THE escape from the catch-22: in ONE fresh WSL session (after wsl --shutdown),
# load uinput BEFORE starting phone-01, so redroid's uinputd builds the touch
# device, AND the NAT is fresh so internet works. Order is critical:
#   modprobe uinput -> dockerd -> DB/redis -> phone-01 (touch dev built at init)
SUDO_PASS=163244
S=127.0.0.1:5555
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_bringup.out"
HERE="/mnt/c/Yeni klasör/vps/deploy/local-test"
: > "$OUT"
SU(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

# 1. uinput FIRST (before any container)
SU modprobe uinput 2>/dev/null; SU modprobe evdev 2>/dev/null
echo "uinput=$(ls /dev/uinput 2>&1 | tr -d '\r')" >> "$OUT"

# 2. binderfs
SU mkdir -p /dev/binderfs
mount | grep -q /dev/binderfs || SU mount -t binder binder /dev/binderfs

# 3. dockerd
if SU docker info >/dev/null 2>&1; then echo "docker=up" >> "$OUT"; else
  echo "$SUDO_PASS" | sudo -S nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
  for i in $(seq 1 40); do SU docker info >/dev/null 2>&1 && break; sleep 1; done
  echo "docker=$(SU docker info >/dev/null 2>&1 && echo up || echo FAIL)" >> "$OUT"
fi

# 4. loopback policy rule
ip route get 127.0.0.1 >/dev/null 2>&1 || { SU ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null; SU ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null; }

# 5. DB + redis (host net)
SU docker compose -f "$HERE/db-hostnet.yml" up -d >/dev/null 2>&1
for i in $(seq 1 30); do SU docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
echo "db=ready" >> "$OUT"

# 6. phone-01 — it auto-starts via restart policy; if running, RESTART it now that
#    uinput exists so uinputd builds the touchscreen. (Single session = NAT ok.)
SU docker restart fleet-local-phone-01 >/dev/null 2>&1
echo "phone-01 restarted with uinput present" >> "$OUT"

# 7. wait boot
adb connect "$S" >/dev/null 2>&1
for i in $(seq 1 40); do
  [ "$(adb -s "$S" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "booted ($i)" >> "$OUT"; break; }
  sleep 2
done

# 8. ensure default route (docker may have wiped) — try candidates
CUR=$(ip -4 -o addr show eth0 | grep -oE '172\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
O3=$(echo "$CUR" | cut -d. -f3)
ip route show default | grep -q '^default' || {
  for gw in "172.28.${O3}.1" "172.28.0.1"; do
    SU ip route replace default via "$gw" dev eth0 2>/dev/null
    timeout 5 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && break
    SU ip route del default 2>/dev/null
  done
}
echo "host_internet=$(timeout 6 curl -s -o /dev/null -w '%{http_code}' https://www.google.com 2>/dev/null)" >> "$OUT"
echo "touch_dev=$(adb -s "$S" shell ls /dev/input/ 2>&1 | tr -d '\r')" >> "$OUT"
echo "phone_net=$(adb -s "$S" shell dumpsys connectivity 2>/dev/null | grep -oE 'Validated|NO_INTERNET' | head -1 | tr -d '\r')" >> "$OUT"
echo "=== RESULT ==="; cat "$OUT"
