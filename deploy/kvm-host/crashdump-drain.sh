#!/bin/bash
# crashdump-drain.sh — 3 Eyl 2026 crash_dump64 zincir kalintisini GUVENLI erit.
# ★NEDEN DALGA: 19:18'de 131K surece tek seferde kill -9 → load 2586, host 9 dk
# tamamen sessiz (ping yok). Bu betik 2000/dalga, 6 sn ara, load>400'de mola.
# Kill -9 ZORUNLU: surecler ptrace-stop'ta (SIGTERM/SIGCONT etkisiz — olculdu).
set -u
LST(){ find /proc -maxdepth 2 -name comm -exec grep -l '^crash_dump64$' {} + 2>/dev/null | sed 's|/proc/||;s|/comm||' | sort -n; }
echo "baslangic: crash_dump64=$(LST | wc -l) load=$(cut -d' ' -f1 /proc/loadavg) adb=$(adb devices 2>/dev/null | grep -c 'device$')"
for w in $(seq 1 120); do
  L=$(cut -d' ' -f1 /proc/loadavg | cut -d. -f1)
  if [ "$L" -gt 400 ]; then echo "  load=$L → 20 sn mola"; sleep 20; continue; fi
  P=$(LST | head -2000); [ -z "$P" ] && break
  echo "$P" | xargs -r kill -9 2>/dev/null
  sleep 6
  [ $((w%5)) -eq 0 ] && echo "  dalga $w: kalan=$(LST | wc -l) load=$(cut -d' ' -f1 /proc/loadavg) adb=$(adb devices 2>/dev/null | grep -c 'device$')"
done
sleep 10
echo "SON: crash_dump64=$(LST | wc -l) surec=$(ls /proc | grep -c '^[0-9]') load=$(cut -d' ' -f1-3 /proc/loadavg) adb=$(adb devices 2>/dev/null | grep -c 'device$')"
