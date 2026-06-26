#!/usr/bin/env bash
# Find an input method that ACTUALLY types into WhatsApp's registration_phone on
# redroid (custom ROM), where plain `input text` is ignored. No SMS number is
# spent — we just type a dummy "123456789" and read back the field value.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
dump() { adb -s "$S" shell uiautomator dump /sdcard/m.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/m.xml /tmp/m.xml >/dev/null 2>&1; }
centerOf() {
  grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/m.xml 2>/dev/null \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 | grep -oE '[0-9]+' | paste -sd' ' \
    | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}
phoneText() { grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*text="[^"]*"' /tmp/m.xml 2>/dev/null | grep -oE 'text="[^"]*"' | head -1; }

dump
PH=$(centerOf 'com.whatsapp:id/registration_phone')
echo "phone field center: $PH"
[ -z "$PH" ] && { echo "phone field not found (wrong screen?)"; exit 1; }

# --- Method 1: per-digit keyevent (KEYCODE_7..) bypasses IME text injection ---
echo "=== Method 1: per-digit keyevents ==="
adb -s "$S" shell input tap $PH; sleep 1
# clear
adb -s "$S" shell input keyevent KEYCODE_MOVE_END
for i in $(seq 1 15); do adb -s "$S" shell input keyevent KEYCODE_DEL; done
# type 1234567 via KEYCODE_1..7
for k in KEYCODE_1 KEYCODE_2 KEYCODE_3 KEYCODE_4 KEYCODE_5 KEYCODE_6 KEYCODE_7; do
  adb -s "$S" shell input keyevent $k
done
sleep 1; dump
echo "  after keyevents, phone = $(phoneText)"

# --- Method 2: clipboard + paste ---
echo "=== Method 2: clipboard paste ==="
adb -s "$S" shell input tap $PH; sleep 1
adb -s "$S" shell input keyevent KEYCODE_MOVE_END
for i in $(seq 1 15); do adb -s "$S" shell input keyevent KEYCODE_DEL; done
# set clipboard via service call is complex; try am broadcast clipper (if any) else skip
adb -s "$S" shell "service call clipboard 2 i32 1 i32 0 s16 com.android.shell s16 '987654321'" >/dev/null 2>&1
adb -s "$S" shell input keyevent 279  # KEYCODE_PASTE
sleep 1; dump
echo "  after paste, phone = $(phoneText)"

# --- report which IMEs are installed ---
echo "=== installed IMEs ==="
adb -s "$S" shell ime list -s 2>/dev/null | tr -d '\r'
echo "=== default IME ==="
adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r'
