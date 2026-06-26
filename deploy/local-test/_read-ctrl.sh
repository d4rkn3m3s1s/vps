#!/usr/bin/env bash
D=/tmp/scrdec/out/sources/com/genymobile/scrcpy
echo "=== Controller.java control loop (how it reads) ==="
find "$D" -name "Controller.java" -exec grep -nE "control\(|read\(\)|handleEvent|while|InjectKeycode|injectKeycode|injectEvent" {} \; 2>/dev/null | head -20
echo "=== how injectKeycode actually injects (InputManager mode) ==="
find "$D" -name "Controller.java" -exec sed -n '/injectKeycode\|injectKeyEvent\|injectEvent/,+8p' {} \; 2>/dev/null | head -40
