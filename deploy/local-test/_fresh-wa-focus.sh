#!/usr/bin/env bash
# Re-enable internet, force-stop + clear WA, relaunch fresh, navigate to
# RegisterPhone, and test tap-focus immediately (fresh state = touch usually
# works). Reports whether focus works on a fresh launch.
export ANDROID_SERIAL=127.0.0.1:5555
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_fresh-wa.out"
DUMP="/mnt/c/Yeni klasör/vps/deploy/local-test/_fw.xml"
: > "$OUT"

# internet back on
adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1
adb shell svc wifi enable >/dev/null 2>&1
adb shell svc data enable >/dev/null 2>&1
sleep 3
echo "net=$(adb shell dumpsys connectivity 2>/dev/null | grep -oE 'Validated|NO_INTERNET' | head -1 | tr -d '\r')" >> "$OUT"

adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
dump(){ adb shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1; adb pull /sdcard/d.xml "$DUMP" >/dev/null 2>&1; }
taptxt(){ dump; local b n; b=$(grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" "$DUMP" | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; n=($(echo "$b" | grep -oE '[0-9]+')); adb shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }
phf(){ grep -oE 'registration_phone"[^>]*focused="[a-z]+"' "$DUMP" | grep -oE 'focused="[a-z]+"' | head -1; }

# fresh WA
adb shell am force-stop com.whatsapp >/dev/null 2>&1
adb shell pm clear com.whatsapp >/dev/null 2>&1
adb shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 9
taptxt 'OK' >/dev/null 2>&1; sleep 2
# EULA (uppercase or mixed)
taptxt 'AGREE AND CONTINUE' >/dev/null 2>&1; taptxt 'Agree and continue' >/dev/null 2>&1; sleep 5
dump
if grep -qiE 'companion|Link a device|Use WhatsApp on another' "$DUMP"; then
  adb shell input tap 567 78 >/dev/null 2>&1; sleep 2
  taptxt 'Register new account' >/dev/null 2>&1; sleep 3
fi
adb shell pm grant com.whatsapp android.permission.POST_NOTIFICATIONS >/dev/null 2>&1
taptxt 'ALLOW' >/dev/null 2>&1; sleep 1

dump
echo "on_RegisterPhone=$(grep -c registration_phone "$DUMP")" >> "$OUT"
# test focus immediately on fresh screen
for t in 1 2 3; do
  adb shell input tap 359 386; sleep 1; dump
  f=$(phf); echo "fresh tap $t: focused=$f" >> "$OUT"
  [ "$f" = 'focused="true"' ] && break
done
echo "=== RESULT ==="; cat "$OUT"
