#!/usr/bin/env bash
# Definitive touch test: monitor /dev/input/event0 while tapping, and check if
# the WhatsApp EULA advances. Proves whether synthetic tap reaches the vinput
# touchscreen AND whether WhatsApp acts on it.
S=127.0.0.1:5555
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"

# clean stale emulator entries so -s works unambiguously
adb disconnect emulator-5554 >/dev/null 2>&1
adb disconnect emulator-5556 >/dev/null 2>&1
adb connect "$S" >/dev/null 2>&1

echo "=== before: top activity + first texts ==="
adb -s "$S" shell uiautomator dump /sdcard/b.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/b.xml /tmp/b.xml >/dev/null 2>&1
grep -oE 'text="[^"]+"' /tmp/b.xml | head -4 | tr '\n' '|'; echo ""

echo "=== monitor event0 during tap ==="
( timeout 5 adb -s "$S" shell getevent /dev/input/event0 ) > /tmp/ev.txt 2>&1 &
MON=$!
sleep 1
# tap "Agree and continue" (visible center ~300,1031)
adb -s "$S" shell input tap 300 1031
sleep 4
wait $MON 2>/dev/null
echo "  event lines captured: $(wc -l < /tmp/ev.txt 2>/dev/null)"
head -3 /tmp/ev.txt 2>/dev/null | tr -d '\r'

echo "=== after: did it advance? ==="
sleep 2
adb -s "$S" shell uiautomator dump /sdcard/c.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/c.xml /tmp/c.xml >/dev/null 2>&1
grep -oE 'text="[^"]+"' /tmp/c.xml | head -6 | tr '\n' '|'; echo ""
adb -s "$S" exec-out screencap -p > "$OUT/wa_aftertap.png" 2>/dev/null && echo "shot: wa_aftertap.png"
