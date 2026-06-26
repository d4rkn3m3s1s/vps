#!/usr/bin/env bash
JAR=/tmp/fleet-crawl.txt
body=$(curl -s -b "$JAR" http://localhost:3000/billing)
echo "bytes: $(echo "$body" | wc -c)"
echo "=== test each pattern ==="
declare -a PATS=("Application error" "Internal Server Error" "500:" "TypeError" "ReferenceError" "could not be found" "Bir hata" "yüklenemedi")
for p in "${PATS[@]}"; do
  n=$(echo "$body" | grep -ioF "$p" | wc -l)
  [ "$n" -gt 0 ] && echo "  HIT [$p] x$n"
done
echo "=== show the surrounding html for the hit ==="
echo "$body" | grep -ioF -A0 "could not be found" | head -1
echo "--- 404 marker present? (next not-found embeds this) ---"
echo "$body" | grep -ioF "This page could not be found" | head -1
echo "--- real app error? ---"
echo "$body" | grep -ioF "Application error: a client-side exception" | head -1
