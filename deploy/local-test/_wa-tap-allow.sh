#!/usr/bin/env bash
S="127.0.0.1:5555"
echo "=== tap ALLOW (center of [75,621][525,705] = 300,663) ==="
adb -s "$S" shell input tap 300 663
sleep 3
echo "=== now dump registration screen ==="
adb -s "$S" shell uiautomator dump /sdcard/r.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/r.xml /tmp/reg.xml 2>&1 | tail -1
echo "=== WhatsApp resource-ids on this screen ==="
grep -oE 'resource-id="com.whatsapp:id/[^"]+"' /tmp/reg.xml 2>/dev/null | sort -u
echo "=== EditText fields ==="
grep -oE 'class="android.widget.EditText"[^>]*resource-id="[^"]*"|resource-id="[^"]*"[^>]*class="android.widget.EditText"' /tmp/reg.xml 2>/dev/null | head
echo "=== visible texts ==="
grep -oE 'text="[^"]+"' /tmp/reg.xml 2>/dev/null | sed 's/text="//;s/"$//' | grep -v '^$' | head -15
