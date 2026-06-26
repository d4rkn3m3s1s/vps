#!/usr/bin/env bash
# Tiny ADB UIAutomator helper for live-probing screens. Avoids the heredoc
# quoting hell of inlining regexes through `wsl bash -lc`.
#   _ui.sh dump                 → print all text + content-desc on screen
#   _ui.sh tap <query>          → tap first node whose text OR desc contains query
#   _ui.sh type <text>          → input text (spaces → %s)
#   _ui.sh shot <name>          → screencap to /tmp/<name>.png and pull to host
SER="${SER:-127.0.0.1:5555}"
XML=/sdcard/_ui.xml

_dump_xml() { adb -s "$SER" shell uiautomator dump "$XML" >/dev/null 2>&1; adb -s "$SER" shell cat "$XML" 2>/dev/null; }

case "$1" in
  dump)
    _dump_xml | grep -oE 'text="[^"]+"|content-desc="[^"]+"' \
      | sed 's/text=/T: /; s/content-desc=/D: /; s/"//g' | grep -vE ': *$'
    ;;
  tap)
    Q="$2"
    # Find the first <node> whose text or content-desc contains Q, grab its bounds.
    NODE=$(_dump_xml | tr '>' '>\n' | grep -iE "(text|content-desc)=\"[^\"]*${Q}[^\"]*\"" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1)
    NUMS=$(echo "$NODE" | grep -oE '[0-9]+')
    set -- $NUMS
    if [ "$#" -ge 4 ]; then
      CX=$(( ($1 + $3) / 2 )); CY=$(( ($2 + $4) / 2 ))
      echo "tap '$Q' @ $CX,$CY"
      adb -s "$SER" shell input tap "$CX" "$CY"
    else
      echo "NOT FOUND: '$Q'"
      exit 1
    fi
    ;;
  type)
    adb -s "$SER" shell input text "$(echo "$2" | sed 's/ /%s/g')"
    ;;
  shot)
    adb -s "$SER" shell screencap -p "/sdcard/$2.png" >/dev/null 2>&1
    adb -s "$SER" pull "/sdcard/$2.png" "/tmp/$2.png" >/dev/null 2>&1
    echo "/tmp/$2.png"
    ;;
  *)
    echo "usage: _ui.sh {dump|tap <q>|type <t>|shot <name>}"
    ;;
esac
