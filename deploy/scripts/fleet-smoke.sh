#!/bin/bash
# fleet-smoke.sh — deploy sonrasi hizli saglik/regresyon kontrolu (~30 sn)
# Kullanim: sudo bash fleet-smoke.sh
#
# NEDEN VAR: projede test yok, tek kapi `tsc --noEmit`. 11 Agustos'ta 13 commit
# atildi ve her deploy sonrasi ayni dogrulamalar ELLE tekrarlandi. Bu betik o
# dogrulamalarin tamami.
#
# ⚠️ SADECE OKUMA YAPAR. Hicbir uretim islemi tetiklemez — ne is kaydi acar, ne
# cihaz kurar, ne yazma ucu cagirir. (11 Agu'da `POST /provision/create` ucu
# "erisilebilir mi" diye yoklanirken GERCEK bir kurulum baslatti ve istenmeyen
# bir cihaz olustu; bu betik o hatayi tekrarlamamak icin tasarlandi.)
set -uo pipefail

API="${FLEET_API_URL:-http://127.0.0.1:4000}"
PANEL="${FLEET_PANEL_URL:-http://127.0.0.1:3000}"
PASS=0; FAIL=0; WARN=0
FAILED_LIST=""

ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); FAILED_LIST="$FAILED_LIST\n    - $1"; printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { WARN=$((WARN+1)); printf '  \033[33m!\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_() { sudo docker exec -i fleet-postgres psql -U postgres -d fleet -t -A "$@" 2>/dev/null; }

# ── 1) Servisler ────────────────────────────────────────────────────────────
head_ "1) Servisler"
for s in fleet-api fleet-agent fleet-dashboard; do
  st="$(systemctl is-active "$s" 2>/dev/null)"
  [ "$st" = "active" ] && ok "$s: active" || bad "$s: $st"
done
for c in fleet-postgres fleet-redis; do
  sudo docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c" && ok "$c: up" || bad "$c: calismiyor"
done

# ── 2) API ucu ──────────────────────────────────────────────────────────────
head_ "2) API"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API/health")"
[ "$code" = "200" ] && ok "/health -> 200" || bad "/health -> $code"

# Kimlik bilgileri .env'den; yoksa auth testleri atlanir (betik yine de calisir).
if [ -f /opt/fleet/apps/api/.env ]; then
  set -a; . /opt/fleet/apps/api/.env 2>/dev/null; set +a
fi
AK="${DEFAULT_API_KEY:-${FLEET_API_KEY:-}}"
AE="${ADMIN_EMAIL:-admin@local.dev}"
TOK=""
if [ -n "$AK" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  TOK="$(curl -s --max-time 12 -X POST "$API/auth/login" -H 'content-type: application/json' \
        -H "x-api-key: $AK" -d "{\"email\":\"$AE\",\"password\":\"$ADMIN_PASSWORD\"}" \
        | grep -oE '"accessToken":"[^"]+' | cut -d'"' -f4)"
  [ -n "$TOK" ] && ok "auth/login -> token alindi" || bad "auth/login -> token ALINAMADI"
else
  warn "ADMIN_PASSWORD/API key yok — auth testleri atlandi"
fi

if [ -n "$TOK" ]; then
  for path in /jobs /billing /devices; do
    c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" "$API$path")"
    [ "$c" = "200" ] && ok "GET $path -> 200" || bad "GET $path -> $c"
  done
  # Yetkisiz erisim REDDEDILMELI (guvenlik regresyonu yakalar)
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H "x-api-key: $AK" "$API/farm/tick")"
  [ "$c" = "401" ] || [ "$c" = "403" ] && ok "POST /farm/tick (tokensiz) -> $c (reddedildi)" || bad "POST /farm/tick tokensiz $c DONDU (korumasiz!)"
  # ★ AGIR UC: /analytics/summary 12 Agu'da API'yi COKERTIYORDU (298 MB JSON'u
  # bellege cekiyordu -> SIGABRT). Burada hem yanit hem de SURECIN AYAKTA KALDIGI
  # kontrol ediliyor: PID degisirse cokme geri gelmis demektir.
  pid0="$(systemctl show fleet-api -p MainPID --value 2>/dev/null)"
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" "$API/analytics/summary")"
  sleep 2
  pid1="$(systemctl show fleet-api -p MainPID --value 2>/dev/null)"
  if [ "$c" = "200" ] && [ "$pid0" = "$pid1" ]; then
    ok "/analytics/summary -> 200 (API ayakta kaldi)"
  elif [ "$pid0" != "$pid1" ]; then
    bad "/analytics/summary API'yi COKERTTI (PID $pid0 -> $pid1) — agir sorgu regresyonu"
  else
    bad "/analytics/summary -> $c"
  fi

  # WS token: uretiliyor mu ve KISA omurlu mu (10 dk)
  wt="$(curl -s --max-time 10 -X POST -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" "$API/auth/ws-token" | grep -oE '"token":"[^"]+' | cut -d'"' -f4)"
  if [ -n "$wt" ]; then
    p="$(echo "$wt" | cut -d. -f2 | tr '_-' '/+')"; case $(( ${#p} % 4 )) in 2) p="$p==";; 3) p="$p=";; esac
    j="$(echo "$p" | base64 -d 2>/dev/null)"
    iat="$(echo "$j" | grep -oE '"iat":[0-9]+' | grep -oE '[0-9]+')"
    exp="$(echo "$j" | grep -oE '"exp":[0-9]+' | grep -oE '[0-9]+')"
    if [ -n "$iat" ] && [ -n "$exp" ]; then
      mins=$(( (exp - iat) / 60 ))
      [ "$mins" -le 15 ] && ok "ws-token omru ${mins} dk (kisa)" || bad "ws-token omru ${mins} dk — 2 saatlik tam yetkili token'a geri donmus olabilir"
    fi
  else
    bad "auth/ws-token -> token uretilemedi (panel canli akisi kirilir)"
  fi
fi

# ── 3) Agent ────────────────────────────────────────────────────────────────
head_ "3) Agent"
P="$(systemctl show fleet-agent -p MainPID --value 2>/dev/null)"
if [ -n "$P" ] && [ "$P" != "0" ]; then
  env_="$(sudo cat "/proc/$P/environ" 2>/dev/null | tr '\0' '\n')"
  AURL="$(echo "$env_" | grep '^FLEET_API_URL=' | cut -d= -f2-)"
  AKEY="$(echo "$env_" | grep '^FLEET_API_KEY=' | cut -d= -f2-)"
  HKEY="$(echo "$env_" | grep '^FLEET_HOST_KEY=' | cut -d= -f2-)"
  [ -n "$AKEY" ] && [ -n "$HKEY" ] && ok "agent env: API_KEY + HOST_KEY yerinde" || bad "agent env: kimlik degiskenleri EKSIK"
  if [ -n "$AKEY" ] && [ -n "$HKEY" ]; then
    # ⚠️ GET kullaniliyor: claim ucu GET'tir. POST 404 doner (yanilticidir).
    c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 -H "x-api-key: $AKEY" -H "x-agent-key: $HKEY" "${AURL:-$API}/agent/jobs/next")"
    [ "$c" = "200" ] && ok "GET /agent/jobs/next -> 200 (is cekebiliyor)" || bad "GET /agent/jobs/next -> $c (AGENT IS CEKEMIYOR)"
  fi
else
  bad "agent MainPID okunamadi"
fi

# ── 4) Panel ────────────────────────────────────────────────────────────────
head_ "4) Panel"
c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$PANEL/login")"
[ "$c" = "200" ] && ok "/login -> 200" || bad "/login -> $c"
# Korumali sayfalar giris istemeli (307). 200 donerse auth KIRILMIS demektir.
for pg in /profiles /jobs /whatsapp; do
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$PANEL$pg")"
  [ "$c" = "307" ] || [ "$c" = "302" ] && ok "$pg -> $c (giris istiyor)" || bad "$pg -> $c (auth korumasi BEKLENMEDIK)"
done

# ── 5) Veri tutarliligi ─────────────────────────────────────────────────────
head_ "5) Veri"
online="$(psql_ -c 'SELECT count(*) FROM "Device" WHERE status='"'"'ONLINE'"'"';')"
[ -n "$online" ] && [ "$online" -gt 0 ] && ok "ONLINE cihaz: $online" || bad "ONLINE cihaz sorgusu basarisiz/0"
stuck="$(psql_ -c 'SELECT count(*) FROM "Job" WHERE status='"'"'RUNNING'"'"' AND "updatedAt" < now()-interval '"'"'2 hours'"'"';')"
[ "${stuck:-0}" = "0" ] && ok "takili job (>2sa RUNNING): 0" || warn "takili job: $stuck"
badproxy="$(psql_ -c 'SELECT count(*) FROM "Proxy" WHERE status='"'"'FAILED'"'"';')"
[ "${badproxy:-0}" = "0" ] && ok "FAILED proxy kaydi: 0" || warn "FAILED proxy kaydi: $badproxy"
orphan="$(psql_ -c 'SELECT count(*) FROM "GeneratedAccount" a WHERE a."deviceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Device" d WHERE d.id=a."deviceId");')"
[ "${orphan:-0}" = "0" ] && ok "oksuz hesap: 0" || warn "oksuz hesap: $orphan"

# ── 6) Altyapi ──────────────────────────────────────────────────────────────
head_ "6) Altyapi"
# SUBNET CAKISMASI: 11 Agu'da kurulumlari olduren hataydi — ayni /24'u iki bridge
# kullaninca yonlendirme bozuluyor ve cihaz "No route to host" veriyor.
dup="$(ip -o -4 addr show 2>/dev/null | grep -oE '192\.168\.[0-9]+\.1/24' | sort | uniq -d | wc -l)"
[ "$dup" = "0" ] && ok "subnet cakismasi: yok" || bad "SUBNET CAKISMASI: $dup adet (kurulum kirilir)"
# Canli instance'in haritada kaydi olmali; yoksa restart'ta SUBNET DEGISIR.
live_c="$(ls -d /var/lib/waydroid.mi* 2>/dev/null | wc -l)"
if [ "$live_c" -gt 0 ]; then
  ls -d /var/lib/waydroid.mi* 2>/dev/null | sed 's|.*waydroid\.||' | sort > /tmp/_smoke_live
  sudo awk '{print $1}' /var/lib/waydroid-subnets.map 2>/dev/null | sort -u > /tmp/_smoke_map
  miss="$(comm -23 /tmp/_smoke_live /tmp/_smoke_map | wc -l)"
  [ "$miss" = "0" ] && ok "instance/harita tutarli ($live_c instance)" || bad "$miss instance haritada YOK (restart'ta subnet degisir)"
  rm -f /tmp/_smoke_live /tmp/_smoke_map
fi
dfp="$(df --output=pcent / 2>/dev/null | tail -1 | tr -dc '0-9')"
[ "${dfp:-0}" -lt 85 ] && ok "disk kullanimi: %${dfp}" || bad "DISK DOLUYOR: %${dfp}"
zomb="$(ps -eo stat 2>/dev/null | grep -c '^Z')"
[ "${zomb:-0}" -lt 20 ] && ok "zombie surec: $zomb" || warn "zombie surec: $zomb"

# ── Ozet ────────────────────────────────────────────────────────────────────
printf '\n\033[1m── OZET ──\033[0m\n'
printf '  gecti: %d · uyari: %d · \033[31mHATA: %d\033[0m\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '  basarisiz kontroller:%b\n' "$FAILED_LIST"
  exit 1
fi
exit 0
