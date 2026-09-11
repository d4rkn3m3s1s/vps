#!/usr/bin/env bash
# ★★★ES ZAMANLI KURULUM CANARY'si — haftalik regresyon yakalayici.
#
# NEDEN: gunluk `wd-canary.sh` TEK cihaz kuruyor ve yalniz-tek-kurulum yolunu
# dogruluyor. 4 Eyl'de ogrendik ki asil tuzak ES ZAMANLILIKTA: iki kurulum ayni
# anda kosunca `wd-run.sh`'in dort kopyasi birbirinin konteynerini olduruyordu
# (wd-mi484-run.log: 4 WATCHDOG_START, `kill -9` ile oldurulen container/session,
# journal'da `Link DOWN` +8sn, DHCP oldu, boot 360sn'de TIMEOUT). Gunluk canary
# bunu HIC goremedi — cunku tek cihaz kuruyordu. Bu betik tam o bosluğu kapatir.
#
# NE YAPAR: IKI cihazi AYNI ANDA kurar, ikisinin de gercekten calistigini dogrular
# (boot + DHCP-lease + ADB + WhatsApp sureci), sonra IKISINI de siler. Herhangi biri
# patlarsa /agent/health-alert ile alarm ureti (wd-canary.sh ile ayni yol).
#
# ★KURULUM DISI HICBIR SEYE DOKUNMAZ: mevcut cihazlara, NAT'a, proxy'ye, gozcuye
#   dokunmaz. Yalnizca iki gecici cihaz acar ve siler.
#
# Kullanim: sudo bash wd-canary-parallel.sh [ulke]     (varsayilan TR)
# Zamanlama: haftalik systemd timer (wd-canary-parallel.timer)
set -uo pipefail

# ★TEK-CALISMA KILIDI — gunluk canary'ninkinden AYRI dosya, ama ikisi ayni anda
# kosmamali: gunluk canary de cihaz kurup siliyor ve instance adlari geri-donusumlu
# (28 Tem: iki canary ayni ada carpip birbirinin cihazini yarim kurulumda sildi).
exec 9>/run/wd-canary-parallel.lock
flock -n 9 || { echo "$(date '+%F %T') es-zamanli canary zaten calisiyor — atlandi" >> /var/log/wd-canary.log; exit 0; }
# Gunluk canary kosuyorsa BEKLEME, atla (haftalik test bir sonraki turda kosar).
if [ -e /run/wd-canary.lock ] && ! flock -n 8 8>/run/wd-canary.lock; then
  echo "$(date '+%F %T') gunluk canary kosuyor — es-zamanli test ATLANDI" >> /var/log/wd-canary.log
  exit 0
fi

CC="${1:-TR}"
API="${FLEET_API_URL:-http://127.0.0.1:4000}"
LOG=/var/log/wd-canary.log
DASH_ENV=/opt/fleet/apps/dashboard/.env
AGENT_ENV=/opt/fleet-agent/agent.env
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
# Es zamanli kurulum tek kurulumdan yavastir (ayni anda iki boot). Tek kurulum
# ~95-110 sn olculdu (11 Eyl); es zamanli icin genis pay birakiyoruz.
WAIT_MAX="${WD_PARALLEL_WAIT_MAX:-600}"

log() { echo "$(date '+%F %T') [es-zamanli] $*" | tee -a "$LOG"; }

AK=$(grep -E '^FLEET_API_KEY=' "$AGENT_ENV" 2>/dev/null | cut -d= -f2)
HK=$(grep -E '^FLEET_HOST_KEY=' "$AGENT_ENV" 2>/dev/null | cut -d= -f2)
EM=$(grep -E '^ADMIN_EMAIL=' "$DASH_ENV" 2>/dev/null | cut -d= -f2)
PW=$(grep -E '^ADMIN_PASSWORD=' "$DASH_ENV" 2>/dev/null | cut -d= -f2)
[ -z "$AK" ] && { log "HATA: FLEET_API_KEY yok"; exit 1; }

# Alarm: wd-canary.sh ile AYNI kurgu (HMAC imzali, govdeyi node uretir).
# ⚠️Govdeyi elle kacislamak bu ortamda guvenli degil (ters bolu ikilileri diske
#   tek olarak dusuyor) — bu yuzden JSON'u node uretiyor.
notify() {
  [ -z "$AK" ] && return 0
  local body ts sign path
  path="/agent/health-alert"
  body=$("$NODE_BIN" -e 'const a=process.argv.slice(1);process.stdout.write(JSON.stringify({kind:"CANARY_PARALLEL_FAILED",instance:"canary-parallel",detail:a[0],fixed:false}))' "$1" 2>/dev/null)
  [ -z "$body" ] && return 0
  ts=$(date +%s%3N)
  sign=$(printf '%s' "${ts}.POST.${path}.${body}" | openssl dgst -sha256 -hmac "${HK:-}" -r 2>/dev/null | cut -d' ' -f1)
  timeout 12 curl -s -o /dev/null -X POST "$API$path" \
    -H "x-api-key: $AK" -H "x-agent-key: ${HK:-}" \
    -H "x-agent-ts: $ts" -H "x-agent-sign: $sign" \
    -H 'Content-Type: application/json' -d "$body" 2>/dev/null || true
}

TOK=$(timeout 20 curl -s -X POST "$API/auth/login" -H "x-api-key: $AK" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$EM\",\"password\":\"$PW\"}" 2>/dev/null | grep -oE '"accessToken":"[^"]+"' | cut -d'"' -f4)
[ -z "$TOK" ] && { log "HATA: API girisi basarisiz"; notify "es-zamanli canary: API girisi basarisiz"; exit 1; }

# ── IKI CIHAZI AYNI ANDA baslat ────────────────────────────────────────────────
# ★Ayni saniyede iki `provision/create` — 4 Eyl yarisinin tam kosulu.
INSTS=""; JOBS=""
for n in 1 2; do
  NAME="cpar-$(date +%H%M%S)-$n"
  RESP=$(timeout 30 curl -s -X POST "$API/provision/create" -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" \
         -H 'Content-Type: application/json' -d "{\"name\":\"$NAME\",\"country\":\"$CC\"}" 2>/dev/null)
  I=$(echo "$RESP" | grep -oE '"instance":"[^"]+"' | cut -d'"' -f4)
  J=$(echo "$RESP" | grep -oE '"jobId":"[^"]+"' | cut -d'"' -f4)
  if [ -z "$I" ]; then
    log "HATA: $n. provision baslatilamadi: $(echo "$RESP" | head -c 150)"
  else
    INSTS="$INSTS $I"; JOBS="$JOBS $J"
    log "$n. kurulum basladi: $NAME ($I)"
  fi
done
set -- $INSTS
[ $# -lt 2 ] && { log "BASARISIZ: iki kurulum birden baslatilamadi (baslayan=$#)"; notify "es-zamanli canary: iki kurulum baslatilamadi (baslayan=$#)"; }

# ── Her durumda TEMIZLIK (basarili da olsa, patlasa da) ───────────────────────
# ★KRITIK: kurulum SURERKEN silme (28 Tem dersi) — bu yuzden trap yalnizca
#   bekleme bittikten SONRA is gorur; asagida SIL() cagrilir.
TEMIZLENDI=0
sil_hepsi() {
  [ "$TEMIZLENDI" = "1" ] && return 0
  TEMIZLENDI=1
  for I in $INSTS; do
    timeout 240 bash /opt/fleet-agent/waydroid/wd-destroy.sh "$I" >/dev/null 2>&1 \
      && log "temizlendi ($I)" || log "UYARI: $I silinemedi — elle bak"
  done
}
trap sil_hepsi EXIT

# ── Kurulumlarin bitmesini bekle (is durumu API'si; log grep'leme — 28 Tem dersi) ──
T0=$(date +%s)
BEKLEYEN="$JOBS"
while [ -n "$(echo $BEKLEYEN)" ]; do
  KALAN=""
  for J in $BEKLEYEN; do
    # ★KANITLANMIS KALIP (wd-canary.sh:122): /provision/status ucu + IKI baslik.
    # /public/v1/jobs yolu JWT istemiyor ama provision isini bu uc daha guvenilir
    # raporluyor (gunluk canary Temmuz'dan beri bunu kullaniyor).
    ST=$(timeout 15 curl -s "$API/provision/status/$J" -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" 2>/dev/null | grep -oE '"status":"[^"]+"' | head -1 | cut -d'"' -f4)
    case "$ST" in
      COMPLETED) : ;;                       # bitti, listeden dus
      FAILED)    log "is FAILED: $J" ;;
      *)         KALAN="$KALAN $J" ;;
    esac
  done
  BEKLEYEN="$KALAN"
  [ -z "$(echo $BEKLEYEN)" ] && break
  [ $(( $(date +%s) - T0 )) -gt "$WAIT_MAX" ] && { log "BASARISIZ: ${WAIT_MAX}sn icinde bitmedi (kalan is: $BEKLEYEN)"; break; }
  sleep 10
done
SURE=$(( $(date +%s) - T0 ))

# ── ASIL DOGRULAMA: iki cihaz da GERCEKTEN calisiyor mu ──────────────────────
# 4 Eyl yarisinda belirti tam olarak sudur: konteyner olur, veth duser, DHCP
# lease HIC olusmaz, cihaz statik-IP fallback'e duser. Bu yuzden GERCEK DHCP
# lease'ini de ariyoruz — yalnizca "adb device" demek YETMEZ.
FAILS=""
for I in $INSTS; do
  SUB=$(sh /opt/fleet-agent/waydroid/net-head.sh "$I" 2>/dev/null)
  LEASE="/var/lib/misc/dnsmasq.waydroid-$I.leases"
  # Gercek lease: agi-gecidi tohum satiri (MAC 00:16:3e:f9:d3:03) HARIC.
  IP=$(awk '$2 != "00:16:3e:f9:d3:03" && $3 ~ /^[0-9]+\./ {print $3}' "$LEASE" 2>/dev/null | tail -1)
  if [ -z "$IP" ]; then
    FAILS="$FAILS $I(DHCP-lease-YOK)"
    continue
  fi
  BOOT=$(timeout 15 adb -s "$IP:5555" shell 'getprop sys.boot_completed' </dev/null 2>/dev/null | tr -d '\r')
  WA=$(timeout 15 adb -s "$IP:5555" shell 'pidof com.whatsapp' </dev/null 2>/dev/null | tr -d '\r')
  [ "$BOOT" = "1" ] || FAILS="$FAILS $I(boot=$BOOT)"
  [ -n "$WA" ] || FAILS="$FAILS $I(WA-yok)"
  log "$I: ip=$IP boot=${BOOT:-?} wa=${WA:+var}"
done

# ★YARIS BELIRTISI: run log'da birden fazla WATCHDOG_START = coklu wd-run kopyasi.
for I in $INSTS; do
  W=$(grep -c 'WATCHDOG_START' "/var/log/wd-$I-run.log" 2>/dev/null || echo 0)
  K=$(grep -c 'kill -9 [0-9]' "/var/log/wd-$I-run.log" 2>/dev/null || echo 0)
  [ "${W:-0}" -gt 2 ] && FAILS="$FAILS $I(YARIS:${W}xWATCHDOG,${K}xkill)"
  log "$I: watchdog=$W kill9=$K (yaris korumasi calisiyorsa kill9=0 olmali)"
done

if [ -n "$FAILS" ]; then
  log "★BASARISIZ (${SURE}sn):$FAILS"
  notify "es-zamanli kurulum BASARISIZ (${SURE}sn):$FAILS"
else
  log "OK: iki cihaz es zamanli kuruldu ve dogrulandi (${SURE}sn)"
fi

sil_hepsi
