#!/usr/bin/env bash
# Dump nodes WITH resource-id + class + text/desc, for mapping editable fields.
SER="${SER:-127.0.0.1:5555}"
adb -s "$SER" shell uiautomator dump /sdcard/_ui.xml >/dev/null 2>&1
adb -s "$SER" shell cat /sdcard/_ui.xml 2>/dev/null \
  | tr '>' '>\n' \
  | grep -E 'class="android.widget.(EditText|Button|TextView)"' \
  | grep -oE '(resource-id|text|content-desc|class)="[^"]*"' \
  | paste -sd' ' - \
  | sed 's/<node//g'
# Simpler: print each EditText / Button line with its key attrs.
echo "---- editable + buttons ----"
adb -s "$SER" shell cat /sdcard/_ui.xml 2>/dev/null \
  | tr '>' '>\n' \
  | grep -iE 'EditText|Button' \
  | grep -oE 'resource-id="[^"]*"|text="[^"]*"|content-desc="[^"]*"|class="[^"]*"' \
  | paste -sd'|' - \
  | tr '|' '\n' | grep -iE 'EditText|Button|resource-id' | head -30
