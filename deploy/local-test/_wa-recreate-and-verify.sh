#!/usr/bin/env bash
# Recreate phone-01 (gives WhatsApp-capable touch via fresh uinput), then
# IMMEDIATELY restore the default route (recreate wipes it), re-set ADBKeyboard,
# and verify that tapping WhatsApp's RegisterPhone field ACTUALLY focuses it.
# Stops with a clear verdict so we only register when WA touch truly works.
SUDO_PASS=163244
S=127.0.0.1:5555
GW_DEFAULT=172.28.0.1
SU(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

restore_route(){
  ip route show default 2>/dev/null | grep -q '^default' && return
  # try the gateway already known, then the /20 base
  local cur
  cur=$(ip -4 -o addr show eth0 2>/dev/null | grep -oE '172\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  local gw="$GW_DEFAULT"
  [ -n "$cur" ] && gw="$(echo "$cur" | awk -F. '{print $1"."$2".0.1"}')"
  SU ip route replace default via "$gw" dev eth0 2>/dev/null
  echo "  route restored via $gw"
}

echo "=== recreate phone-01 (uinput-backed touchscreen) ==="
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_fix-touch.sh" 2>&1 | grep -E 'booted|input|getevent|add device|name:' | tr -d '\r'

echo "=== restore route (recreate wipes it) ==="
restore_route
ip route show default | sed 's/^/  /'
timeout 6 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && echo "  host internet: OK" || echo "  host internet: FAIL"

echo "=== phone-01 internet ==="
adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ping -c1 -W3 v.whatsapp.net 2>/dev/null | grep -qE '1 received|bytes from' && echo "  phone-01 WA reachable: OK" || echo "  phone-01 WA: FAIL"

echo "=== re-set ADBKeyboard ==="
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r' | sed 's/^/  IME: /'

echo "=== launch WhatsApp clean to RegisterPhone, tap field, check focus ==="
adb -s "$S" shell pm clear com.whatsapp >/dev/null 2>&1
adb -s "$S" shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 9
# dismiss custom-ROM "OK" + EULA "Agree and continue" if present
dump(){ adb -s "$S" shell uiautomator dump /sdcard/v.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/v.xml /tmp/v.xml >/dev/null 2>&1; }
taptext(){ dump; local b=$(grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/v.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; local n=($(echo "$b" | grep -oE '[0-9]+')); adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }
taptext 'OK' >/dev/null 2>&1; sleep 2
taptext 'Agree and continue' >/dev/null 2>&1; sleep 5
# companion screen? overflow menu -> Register new account
dump
if grep -qiE 'companion|Link a device|QR' /tmp/v.xml; then
  adb -s "$S" shell input tap 567 78 >/dev/null 2>&1; sleep 2
  taptext 'Register new account' >/dev/null 2>&1; sleep 3
fi
taptext 'ALLOW' >/dev/null 2>&1; sleep 1

dump
PH=$(grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/v.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}')
if [ -z "$PH" ]; then echo "  NOT on RegisterPhone (texts: $(grep -oE 'text=\"[^\"]+\"' /tmp/v.xml | head -5 | tr '\n' '|'))"; exit 3; fi
adb -s "$S" shell input tap $PH; sleep 2
dump
FOC=$(grep -oE 'registration_phone"[^>]*focused="[a-z]+"' /tmp/v.xml | grep -oE 'focused="[a-z]+"' | head -1)
IME=$(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')
echo "=== WA FIELD FOCUS: $FOC  IME: $IME ==="
[ "$FOC" = 'focused="true"' ] && echo "VERDICT: WA touch WORKS — ready to register" || echo "VERDICT: WA touch STILL broken after recreate"
