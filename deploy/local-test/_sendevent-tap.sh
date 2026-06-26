#!/usr/bin/env bash
# Raw multitouch tap via sendevent directly to /dev/input/event0 (redroid vinput),
# bypassing the flaky `input tap`. Uses MT protocol B with tracking id.
# Args: $1=X $2=Y  (screen 600x1280)
S=127.0.0.1:5555
X="${1:-300}"
Y="${2:-327}"
DEV=/dev/input/event0
adb disconnect emulator-5554 >/dev/null 2>&1; adb connect "$S" >/dev/null 2>&1

# Event codes: EV_ABS=3 EV_SYN=0 EV_KEY=1
# ABS_MT_SLOT=0x2f(47) ABS_MT_TRACKING_ID=0x39(57) ABS_MT_POSITION_X=0x35(53)
# ABS_MT_POSITION_Y=0x36(54) BTN_TOUCH=0x14a(330) SYN_REPORT=0
adb -s "$S" shell "
sendevent $DEV 3 47 0
sendevent $DEV 3 57 1
sendevent $DEV 1 330 1
sendevent $DEV 3 53 $X
sendevent $DEV 3 54 $Y
sendevent $DEV 0 0 0
sendevent $DEV 3 57 -1
sendevent $DEV 1 330 0
sendevent $DEV 0 0 0
" 2>/dev/null
echo "sendevent tap at ($X,$Y) done"
