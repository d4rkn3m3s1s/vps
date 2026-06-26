#!/usr/bin/env bash
PORT="${1:-5557}"
S="127.0.0.1:$PORT"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad/wa_${PORT}.png"
adb connect "$S" >/dev/null 2>&1
adb -s "$S" exec-out screencap -p > "$OUT" 2>/dev/null
echo "saved $(wc -c < "$OUT") bytes -> $OUT"
echo "=== focused activity ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'mResumedActivity|ResumedActivity' | head -2 | tr -d '\r'
echo "=== WA logcat tail (crash/integrity hints) ==="
adb -s "$S" logcat -d 2>/dev/null | grep -iE 'whatsapp|com.whatsapp' | grep -iE 'crash|fatal|abi|native|integrity|fail' | tail -8
