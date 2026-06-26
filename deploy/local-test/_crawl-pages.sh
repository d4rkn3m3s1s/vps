#!/usr/bin/env bash
# Crawl every dashboard route with a logged-in session and flag pages that error,
# 500, or render an error/empty marker. Surfaces "dangling / not-wired" features.
JAR=/tmp/fleet-crawl.txt; rm -f "$JAR"
curl -s -c "$JAR" -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}' >/dev/null

ROUTES="/ /accounts /admin /ai /alerts /analytics /applications /automation /billing /calendar /console /distribute /farm /fingerprints /geehub /groups /health /hosts /images /library /logs /members /profiles /proxies /referral /reports /resources /rpa /scheduler /settings /synchronizer /wall /webhooks"

printf "%-16s %-6s %-8s %s\n" "ROUTE" "HTTP" "BYTES" "FLAGS"
printf "%-16s %-6s %-8s %s\n" "-----" "----" "-----" "-----"
for r in $ROUTES; do
  body=$(curl -s -b "$JAR" -w '\n__HTTP__%{http_code}__BYTES__%{size_download}' "http://localhost:3000$r" 2>/dev/null)
  code=$(echo "$body" | grep -oE '__HTTP__[0-9]+' | grep -oE '[0-9]+')
  bytes=$(echo "$body" | grep -oE '__BYTES__[0-9]+' | grep -oE '[0-9]+')
  flags=""
  echo "$body" | grep -qiE 'Application error|Internal Server Error|500: |TypeError|ReferenceError|could not be found|Bir hata|yüklenemedi|Yüklenemedi' && flags="${flags}ERR "
  echo "$body" | grep -qiE 'data-error|error-state|class="[^"]*error' && flags="${flags}errbox "
  # very small page (just a shell) may indicate empty/failed server fetch
  [ "${bytes:-0}" -lt 8000 ] && flags="${flags}small"
  printf "%-16s %-6s %-8s %s\n" "$r" "${code:-?}" "${bytes:-?}" "$flags"
done
