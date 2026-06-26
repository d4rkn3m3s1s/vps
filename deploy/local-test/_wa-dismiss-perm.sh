#!/usr/bin/env bash
# Dismiss the "Allow WhatsApp notifications" permission dialog on phone-01, then
# dump the registration screen to confirm field ids.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
echo "=== screen size ==="
adb -s "$S" shell wm size 2>&1 | tr -d '\r'
echo "=== dump permission dialog ==="
adb -s "$S" shell uiautomator dump /sdcard/p.xml 2>&1 | tr -d '\r'
adb -s "$S" pull /sdcard/p.xml /tmp/perm.xml 2>&1 | tail -1
echo "=== ALLOW bounds ==="
grep -oE 'text="ALLOW"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/perm.xml 2>/dev/null | head -1
echo "=== all button-ish nodes ==="
grep -oE '(text|content-desc)="[^"]*([Aa]llow|ALLOW)[^"]*"[^>]*bounds="[^"]+"' /tmp/perm.xml 2>/dev/null | head -4
