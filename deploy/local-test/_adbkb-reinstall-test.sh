#!/usr/bin/env bash
# Reinstall ADBKeyboard fresh and test text injection in a Contacts EditText.
# Writes result to a /mnt/c file (persists across wsl invocations).
export ANDROID_SERIAL=127.0.0.1:5555
APK="/mnt/c/Yeni klasör/vps/deploy/local-test/apks/ADBKeyboard.apk"
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_adbkb-result.txt"
: > "$OUT"

echo "apk: $(ls -la "$APK" 2>&1 | awk '{print $5}')" >> "$OUT"
adb install -r "$APK" >>"$OUT" 2>&1
adb shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
sleep 1

# open Contacts insert (guaranteed EditText)
adb shell am start -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact >/dev/null 2>&1
sleep 4
# tap first EditText (name field ~ 309,547 on 600x1280)
adb shell input tap 309 547; sleep 2
echo "shown=$(adb shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')" >> "$OUT"
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "ZZTEST" 2>&1 | grep -i result | tr -d '\r' >> "$OUT"
sleep 1
adb shell uiautomator dump /sdcard/zz.xml >/dev/null 2>&1
adb pull /sdcard/zz.xml /sdcard_zz.xml >/dev/null 2>&1
adb pull /sdcard/zz.xml "/mnt/c/Yeni klasör/vps/deploy/local-test/_zzdump.xml" >/dev/null 2>&1
CNT=$(grep -c 'ZZTEST' "/mnt/c/Yeni klasör/vps/deploy/local-test/_zzdump.xml" 2>/dev/null)
echo "ZZTEST_landed=$CNT" >> "$OUT"
echo "=== RESULT ==="
cat "$OUT"
