#!/usr/bin/env bash
# Probe WhatsApp first-run screens to map the real anchor texts.
SER=127.0.0.1:5555
dump() { adb -s "$SER" shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; adb -s "$SER" shell cat /sdcard/u.xml 2>/dev/null; }
texts() { dump | grep -oE 'text="[^"]+"|content-desc="[^"]+"' | sed 's/text=//;s/content-desc=//;s/"//g' | grep -v '^$'; }
# Tap a node by text (find its bounds centre).
tapText() {
  local q="$1"
  local line
  line=$(dump | grep -oE "<node[^>]*text=\"[^\"]*$q[^\"]*\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" | head -1)
  local b=$(echo "$line" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '[0-9]+' )
  local arr=($b); 
  if [ ${#arr[@]} -ge 4 ]; then
    local cx=$(( (${arr[0]} + ${arr[2]}) / 2 )); local cy=$(( (${arr[1]} + ${arr[3]}) / 2 ))
    echo "tapping '$q' at $cx,$cy"; adb -s "$SER" shell input tap $cx $cy
  else echo "no node for '$q'"; fi
}

echo "=== screen 1 ==="; texts | head -20
echo "=== tap OK (dismiss custom-ROM alert) ==="; tapText "OK"; sleep 3
echo "=== screen 2 ==="; texts | head -25

echo "=== tap AGREE AND CONTINUE ==="; tapText "AGREE"; sleep 5
echo "=== screen 3 (permissions or phone) ==="; texts | head -25

echo "=== tap More options (overflow menu) ==="; tapText "More options"; sleep 2
echo "=== menu items ==="; texts | head -15
