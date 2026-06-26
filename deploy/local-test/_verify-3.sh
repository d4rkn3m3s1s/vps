#!/usr/bin/env bash
declare -A NAME=( [5555]=phone-01 [5556]=phone-02 [5557]=phone-03 )
for port in 5555 5556 5557; do
  adb connect 127.0.0.1:$port >/dev/null 2>&1
  boot=$(adb -s 127.0.0.1:$port shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  ver=$(adb -s 127.0.0.1:$port shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')
  abi=$(adb -s 127.0.0.1:$port shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r')
  model=$(adb -s 127.0.0.1:$port shell getprop ro.product.model 2>/dev/null | tr -d '\r')
  # quick responsiveness test: list packages count
  pkgs=$(adb -s 127.0.0.1:$port shell pm list packages 2>/dev/null | wc -l | tr -d '\r')
  echo "${NAME[$port]} :$port  boot=$boot  android=$ver  model=$model  pkgs=$pkgs"
  echo "    abilist=$abi"
done
