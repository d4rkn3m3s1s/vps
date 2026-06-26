#!/usr/bin/env bash
# Third pass: remaining SATURATED blue/cyan/violet HEX -> platinum greys, and
# leftover deep-blue background hexes -> neutral near-black. Status colors
# (green #22c55e/#34d399/#4ade80, amber #f59e0b/#fbbf24, red #ef4444/#f87171,
# rose #f43f5e) are intentionally LEFT untouched.
set -e
F='/mnt/c/Yeni klasör/vps/apps/dashboard/src/app/globals.css'

# Saturated blue/indigo/violet accents -> platinum (case-insensitive)
sed -i -E '
  s/#4[fF]7[cC][fF][fF]/#c8ccd4/g;
  s/#3358[dD]4/#9aa0ad/g;
  s/#5[bB]8[cC][fF][fF]/#c8ccd4/g;
  s/#3[aA]5[bB][dD]9/#9aa0ad/g;
  s/#9[bB][cC]0[fF][fF]/#dfe3ea/g;
  s/#93[bB]4[fF][fF]/#dfe3ea/g;
  s/#[cC][fF][eE]0[fF][fF]/#f2f4f8/g;
  s/#[cC]7[dD]2[fF][eE]/#f2f4f8/g;
  s/#[cC]5[cC][eE][dD][eE]/#e3e6ec/g;
  s/#60[aA]5[fF][aA]/#cfd3db/g;
  s/#38[bB][dD][fF]8/#b6bcc6/g;
' "$F"

# Violet / teal accents -> pewter / steel
sed -i -E '
  s/#[aA]78[bB][fF][aA]/#b8bcc8/g;
  s/#7[bB]6[bB][fF][fF]/#b8bcc8/g;
  s/#7[cC]5[cC][fF][fF]/#b0b4c0/g;
  s/#4[fF][dD]1[cC]5/#aeb6c2/g;
  s/#2[bB][bB]6[cC]4/#aeb6c2/g;
  s/#7[cC][eE]0[eE]8/#aeb6c2/g;
  s/#85[fF]7[dD]1/#bcd0c8/g;
' "$F"

# Deep-blue BACKGROUND hexes -> neutral near-black graphite
sed -i -E '
  s/#0[eE]1730/#101012/g;
  s/#08111[dD]/#0a0a0c/g;
  s/#050[bB]14/#070708/g;
  s/#04121[bB]/#0a0a0c/g;
  s/#04060[dfDF]/#060606/g;
  s/#050816/#070708/g;
  s/#0[bB]1226/#0d0d10/g;
  s/#060[aA]1[cC]/#08080a/g;
  s/#06080[fF]/#08080a/g;
  s/#05070[fF]/#070708/g;
  s/#14182[bB]/#141416/g;
  s/#1[bB]2440/#16161a/g;
  s/#1767[0-9a-fA-F][0-9a-fA-F]/#121214/g;
' "$F"

echo "=== leftover saturated blue hexes (target ~0) ==="
grep -oicE '#4f7cff|#5b8cff|#93b4ff|#cfe0ff|#60a5fa|#a78bfa|#38bdf8|#7b6bff|#4fd1c5' "$F" || true
echo "done"
