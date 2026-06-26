#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# VPS Fleet — full LOCAL stack bring-up with THREE redroid cloud phones.
#
# Why this script exists (hard-won, see the per-section notes):
#   This custom WSL2 kernel has NO working docker bridge/veth/nat (CONFIG only
#   has host networking). And two redroid instances on `--network host` collide:
#   the 2nd one's Android `/init` fails a critical service and reboots → exit 129.
#   Bridge mode can't even create an endpoint (exit 128). So the recipe is:
#
#     phone-01  --network host        adbd on host :5555      (the "primary")
#     phone-02  --network none        adbd inside its netns   -> host :5556 via fwd
#     phone-03  --network none (ndk)  adbd inside its netns   -> host :5557 via fwd
#
#   Each phone also gets its OWN isolated binderfs mount (separate `binder`
#   device) so they don't fight over the single shared /dev/binderfs binder node.
#   The --network none phones are reached from the host by a tiny zero-dep Node
#   TCP forwarder (netns-forward.mjs) that pipes host:PORT -> nsenter(netns):5555.
#
# Usage:  SUDO_PASS=xxx bash up-3phones.sh
# ─────────────────────────────────────────────────────────────────────────────
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS="${SUDO_PASS:-163244}"
S() { echo "$PASS" | sudo -S "$@" 2>/dev/null; }
echo "$PASS" | sudo -S true 2>/dev/null   # prime sudo

REDROID13="redroid/redroid:13.0.0-latest"
REDROID11_NDK="redroid/redroid:11.0.0_ndk"

say(){ echo "▶ $*"; }

# 1. binderfs (base) ----------------------------------------------------------
say "binderfs base"
S mkdir -p /dev/binderfs
mountpoint -q /dev/binderfs || S mount -t binder binder /dev/binderfs

# 2. dockerd ------------------------------------------------------------------
if S docker info >/dev/null 2>&1; then say "docker: already up"; else
  say "docker: starting"
  echo "$PASS" | sudo -S nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
  for i in $(seq 1 40); do S docker info >/dev/null 2>&1 && break; sleep 1; done
  S docker info >/dev/null 2>&1 || { echo "docker FAILED"; S tail -15 /tmp/dockerd.log; exit 1; }
fi

# 3. loopback fix (dockerd can wipe the 127/8 policy rule) ---------------------
if ! ip route get 127.0.0.1 >/dev/null 2>&1; then
  S ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null || true
  S ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null || true
fi

# 3b. default-route fix — starting dockerd under NAT mode wipes the eth0 default
# route, killing all outbound internet (sms-bus, apk fetch). Re-add it (gateway
# = first host addr of the eth0 /20). Idempotent.
if ! ip route | grep -q '^default'; then
  GW=$(ip -4 route show dev eth0 | grep -oE '172\.[0-9]+\.[0-9]+\.0/' | head -1 | sed 's#0/#1#')
  [ -z "$GW" ] && GW=172.28.0.1
  S ip route add default via "$GW" dev eth0 2>/dev/null || S ip route replace default via "$GW" dev eth0 2>/dev/null || true
  ip route | grep -q '^default' && say "default route restored ($GW)" || say "WARN: default route still missing"
fi

# 4. Postgres + Redis ---------------------------------------------------------
say "postgres + redis"
S docker compose -f "$HERE/db-hostnet.yml" up -d >/dev/null 2>&1
for i in $(seq 1 30); do S docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

# 4b. input modules — redroid builds its touchscreen via /dev/uinput; this
# custom kernel ships uinput/evdev as modules that aren't auto-loaded, so
# without these /dev/input stays empty and `input tap`/`swipe` never reach the
# UI (only keyevents work). Load them BEFORE the phones boot.
say "input modules (uinput/evdev)"
for m in uinput evdev; do S modprobe "$m" 2>/dev/null || true; done
ls /dev/uinput >/dev/null 2>&1 && say "uinput ready" || say "WARN: /dev/uinput missing (touch may not work)"

# 5. three isolated binderfs instances ---------------------------------------
say "isolated binderfs x3"
for n in 1 2 3; do
  S mkdir -p /dev/binderfs$n
  mountpoint -q /dev/binderfs$n || S mount -t binder binder /dev/binderfs$n
done

# 6. phones -------------------------------------------------------------------
COMMON_DISPLAY=(androidboot.redroid_width=600 androidboot.redroid_height=1280
                androidboot.redroid_dpi=240 androidboot.redroid_fps=30
                androidboot.redroid_gpu_mode=guest)

say "phone-01 (host net, :5555)"
S docker rm -f fleet-local-phone-01 >/dev/null 2>&1
S docker run -d --name fleet-local-phone-01 --privileged --network host \
  -v /dev/binderfs1:/dev/binderfs -v fleet-local_phone01-data:/data \
  --restart unless-stopped "$REDROID13" \
  "${COMMON_DISPLAY[@]}" androidboot.redroid_adbd_port=5555 >/dev/null 2>&1

say "phone-02 (netns none -> fwd :5556)"
S docker rm -f fleet-local-phone-02 >/dev/null 2>&1
S docker run -d --name fleet-local-phone-02 --privileged --network none \
  -v /dev/binderfs2:/dev/binderfs -v fleet-local_phone02-data:/data \
  --restart unless-stopped "$REDROID13" \
  "${COMMON_DISPLAY[@]}" >/dev/null 2>&1

say "phone-03 (netns none, ARM ndk -> fwd :5557)"
S docker rm -f fleet-local-phone-03 >/dev/null 2>&1
S docker run -d --name fleet-local-phone-03 --privileged --network none \
  -v /dev/binderfs3:/dev/binderfs -v fleet-local_phone03-data:/data \
  --restart unless-stopped "$REDROID11_NDK" \
  "${COMMON_DISPLAY[@]}" \
  androidboot.redroid_enable_native_bridge=1 \
  ro.product.cpu.abilist=x86_64,arm64-v8a,x86,armeabi-v7a,armeabi \
  ro.dalvik.vm.native.bridge=libndk_translation.so \
  ro.enable.native.bridge.exec=1 ro.dalvik.vm.isa.arm64=x86_64 >/dev/null 2>&1

# 7. wait for all three to finish booting ------------------------------------
say "waiting for Android boot on all 3 (first boot can take ~30-90s)…"
boot_ok(){ # $1=container
  for i in $(seq 1 60); do
    [ "$(S docker exec "$1" getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && return 0
    sleep 2
  done; return 1
}
boot_ok fleet-local-phone-01 && echo "  phone-01 booted" || echo "  phone-01 TIMEOUT"
boot_ok fleet-local-phone-02 && echo "  phone-02 booted" || echo "  phone-02 TIMEOUT"
boot_ok fleet-local-phone-03 && echo "  phone-03 booted" || echo "  phone-03 TIMEOUT"

# 8. netns forwarders for the --network none phones ---------------------------
say "netns forwarders (5556->phone-02, 5557->phone-03)"
PID2=$(S docker inspect fleet-local-phone-02 --format '{{.State.Pid}}')
PID3=$(S docker inspect fleet-local-phone-03 --format '{{.State.Pid}}')
S pkill -f netns-forward.mjs >/dev/null 2>&1; sleep 1
echo "$PASS" | sudo -S bash -c "nohup setsid node '$HERE/netns-forward.mjs' 5556:$PID2 5557:$PID3 >/tmp/forwarders.log 2>&1 </dev/null &"
sleep 2

# 9. adb connect all ----------------------------------------------------------
say "adb connect"
adb start-server >/dev/null 2>&1
for p in 5555 5556 5557; do adb connect 127.0.0.1:$p >/dev/null 2>&1; done
sleep 2
echo "=== adb devices ==="
adb devices

# 9b. ADBKeyboard — install + set as default IME on each phone. redroid's stock
# IME drops `input text` into apps like WhatsApp; ADBKeyboard injects text via
# the ADB_INPUT_TEXT broadcast which the agent uses for reliable form entry.
if [ -f "$HERE/apks/ADBKeyboard.apk" ]; then
  say "ADBKeyboard (install + default IME)"
  for p in 5555 5556 5557; do
    adb -s 127.0.0.1:$p install -r "$HERE/apks/ADBKeyboard.apk" >/dev/null 2>&1
    # IME registration can lag the install; retry a few times.
    for i in $(seq 1 8); do
      adb -s 127.0.0.1:$p shell ime list -a -s 2>/dev/null | grep -q adbkeyboard && break; sleep 2
    done
    adb -s 127.0.0.1:$p shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
    adb -s 127.0.0.1:$p shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
  done
fi

# 10. mark all three ONLINE bound to host local-wsl2 -------------------------
say "rebind devices -> local-wsl2 + ONLINE"
PSQL='S docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc'
WSL2_ID=$($PSQL "SELECT id FROM \"Host\" WHERE name='local-wsl2';" | tr -d '[:space:]')
$PSQL "UPDATE \"Device\" SET \"hostId\"='$WSL2_ID', \"ipAddress\"='127.0.0.1', \"adbPort\"=5555, status='ONLINE', \"lastSeen\"=now() WHERE name='Local Phone 01';" >/dev/null
$PSQL "UPDATE \"Device\" SET \"hostId\"='$WSL2_ID', \"ipAddress\"='127.0.0.1', \"adbPort\"=5556, status='ONLINE', \"lastSeen\"=now() WHERE name='Local Phone 02';" >/dev/null
$PSQL "UPDATE \"Device\" SET \"hostId\"='$WSL2_ID', \"ipAddress\"='127.0.0.1', \"adbPort\"=5557, status='ONLINE', \"lastSeen\"=now() WHERE name='Local Phone 03';" >/dev/null

echo ""
echo "✅ 3-phone stack up. Now (re)start API, agent, dashboard if needed:"
echo "   bash $HERE/_start-api.sh ; bash $HERE/_start-agent.sh ; bash $HERE/_start-dash.sh"
