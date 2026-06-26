#!/usr/bin/env bash
# Recreate phone-01 WITHOUT use_redroid_stream=1 (yesterday's working config:
# gpu guest, host net, uinput loaded). Restore route. Then test BOTH:
#  (1) tap focuses an EditText, (2) ADBKeyboard commits text.
# Results -> /mnt/c file. uinput must be loaded BEFORE boot for the touchscreen.
SUDO_PASS=163244
S=127.0.0.1:5555
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_nostream-result.txt"
: > "$OUT"
SU(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

SU modprobe uinput 2>/dev/null; SU modprobe evdev 2>/dev/null
echo "uinput: $(ls -la /dev/uinput 2>&1 | head -1)" >> "$OUT"

SU docker rm -f fleet-local-phone-01 >/dev/null 2>&1
sleep 1
SU mkdir -p /dev/binderfs1
mountpoint -q /dev/binderfs1 || SU mount -t binder binder /dev/binderfs1
# NO use_redroid_stream flag (yesterday's config)
SU docker run -d --name fleet-local-phone-01 --privileged --network host \
  -v /dev/binderfs1:/dev/binderfs -v fleet-local_phone01-data:/data \
  --restart unless-stopped \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_adbd_port=5555 >/dev/null 2>&1
echo "recreated (no stream flag)" >> "$OUT"

# restore route
CUR=$(ip -4 -o addr show eth0 | grep -oE '172\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
O3=$(echo "$CUR" | cut -d. -f3); O12=$(echo "$CUR" | cut -d. -f1-2 2>/dev/null)
SU ip route del default 2>/dev/null
for gw in "172.28.${O3}.1" "172.28.0.1" "172.28.6.1"; do
  SU ip route replace default via "$gw" dev eth0 2>/dev/null
  timeout 5 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && { echo "route OK via $gw" >> "$OUT"; break; }
  SU ip route del default 2>/dev/null
done

# wait boot
adb connect "$S" >/dev/null 2>&1
for i in $(seq 1 45); do
  [ "$(adb -s "$S" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "booted ($i)" >> "$OUT"; break; }
  sleep 2
done
echo "input devices: $(adb -s "$S" shell ls /dev/input/ 2>&1 | tr -d '\r')" >> "$OUT"

# ADBKeyboard
adb -s "$S" install -r "/mnt/c/Yeni klasör/vps/deploy/local-test/apks/ADBKeyboard.apk" >/dev/null 2>&1
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

# TEST: Contacts EditText tap-focus + ADBKeyboard type
adb -s "$S" shell am start -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact >/dev/null 2>&1
sleep 4
adb -s "$S" shell input tap 309 547; sleep 2
echo "focus_shown=$(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')" >> "$OUT"
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "WORKS99" >/dev/null 2>&1
sleep 1
adb -s "$S" shell uiautomator dump /sdcard/t.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/t.xml "/mnt/c/Yeni klasör/vps/deploy/local-test/_nstest.xml" >/dev/null 2>&1
echo "WORKS99_landed=$(grep -c 'WORKS99' '/mnt/c/Yeni klasör/vps/deploy/local-test/_nstest.xml' 2>/dev/null)" >> "$OUT"
echo "phone_net=$(adb -s "$S" shell ping -c1 -W3 v.whatsapp.net 2>/dev/null | grep -cE '1 received|bytes from')" >> "$OUT"
echo "=== RESULT ==="
cat "$OUT"
