#!/bin/bash
# ★★ CANARY (regresyon yakalayici) — 2026-07-28
#
# NEDEN: 2026-07-28'de kesfedildi ki YENI kurulan cihazlar DNS'siz kaliyordu (ufw, DHCP'nin
# 0.0.0.0'dan gelen ILK broadcast istegini dusuruyordu). Cihaz "ONLINE" gorunuyordu, IP ile
# HTTP/HTTPS 301/200 donuyordu — ama isim cozemedigi icin WhatsApp kaydi SESSIZCE kiriliyordu.
# Bu hata HAFTALARCA fark edilmedi cunku hicbir kontrol "yeni cihaz gercekten kullanilabilir mi"
# sorusunu UCTAN UCA sormuyordu. Bu script tam olarak onu sorar.
#
# NE YAPAR: gercek bir cihaz kurar -> DNS + internet-cikis + proxy-ulkesi + WhatsApp
# erisilebilirligini dogrular -> cihazi SILER. Herhangi bir adim patlarsa /agent/health-alert
# ile alarm ureti (webhook + Telegram). Basarisiz olsa bile cihazi TEMIZLER (kalinti birakmaz).
#
# Kullanim: sudo bash wd-canary.sh [ulke]     (varsayilan TR)
# Zamanlama: systemd timer (gunde 1) — bkz. dosya sonundaki kurulum notu.
set -uo pipefail

# ★TEK-CALISMA KILIDI: iki canary ayni anda kosarsa ayni instance adina (mi33 gibi, adlar
# geri-donusumlu) CAKISIRLAR ve birbirinin cihazini yarim kurulumda silerler (canli olay:
# 2026-07-28 00:24 vs 00:28 — instance data dizini yok / Magisk FAIL / boot TIMEOUT).
exec 9>/run/wd-canary.lock
flock -n 9 || { echo "$(date '+%F %T') canary zaten calisiyor — atlandi" >> /var/log/wd-canary.log; exit 0; }

CC="${1:-TR}"
API="${FLEET_API_URL:-http://127.0.0.1:4000}"
LOG=/var/log/wd-canary.log
DASH_ENV=/opt/fleet/apps/dashboard/.env
AGENT_ENV=/opt/fleet-agent/agent.env

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

AK=$(grep -E '^FLEET_API_KEY=' "$AGENT_ENV" 2>/dev/null | cut -d= -f2)
HK=$(grep -E '^FLEET_HOST_KEY=' "$AGENT_ENV" 2>/dev/null | cut -d= -f2)
EM=$(grep -E '^ADMIN_EMAIL=' "$DASH_ENV" 2>/dev/null | cut -d= -f2)
PW=$(grep -E '^ADMIN_PASSWORD=' "$DASH_ENV" 2>/dev/null | cut -d= -f2)
[ -z "$AK" ] && { log "HATA: FLEET_API_KEY yok — canary calisamaz"; exit 1; }

# Alarm: health-alert ucuna gonder (wd-health-watch ile ayni yol).
# ★★★2026-08-20 HMAC IMZASI + JSON KACISI (wd-health-watch.sh ile AYNI kurgu).
# Onceden `detail` hic kacislanmiyordu (icinde " olan her uyari bozuk JSON uretirdi)
# ve istek IMZASIZDI. Sunucu kanonik dizesi:
#   ${ts}.${METHOD}.${req.originalUrl}.${JSON.stringify(req.body)}   (agent.signature.ts:89)
# ⚠️FLEET_REQUIRE_AGENT_SIGN=1 acildiginda imzasiz kalan HER cagri 401 alir — canary
#   de health-alert kullandigi icin BURASI DA imzalanmak ZORUNDA.
# ★★★2026-08-20 HMAC IMZASI (wd-health-watch.sh ile AYNI kurgu).
# Onceden `detail` hic kacislanmiyordu ve istek IMZASIZDI.
# Govdeyi NODE uretir: sunucu da JSON.stringify ile yeniden serilestirdigi icin
# gidis-donus BIREBIR ayni olur — HMAC'in tutmasi buna bagli. Elle kacis yazmak
# bu ortamda guvenli degil (ters bolu ikilileri diske tek olarak dusuyor).
# ⚠️FLEET_REQUIRE_AGENT_SIGN=1 acilinca imzasiz her cagri 401 alir — canary de
#   health-alert kullandigi icin BURASI DA imzalanmak ZORUNDA.
NODE_BIN="${NODE_BIN:-/usr/bin/node}"

notify() { # detay
  [ -z "$AK" ] && return 0
  local body ts sign path
  path="/agent/health-alert"
  body=$("$NODE_BIN" -e 'const a=process.argv.slice(1);process.stdout.write(JSON.stringify({kind:"CANARY_FAILED",instance:"canary",detail:a[0],fixed:false}))' "$1" 2>/dev/null)
  [ -z "$body" ] && return 0
  ts=$(date +%s%3N)
  sign=$(printf '%s' "${ts}.POST.${path}.${body}" \
         | openssl dgst -sha256 -hmac "${HK:-}" -r 2>/dev/null | cut -d' ' -f1)
  timeout 12 curl -s -o /dev/null -X POST "$API$path" \
    -H "x-api-key: $AK" -H "x-agent-key: ${HK:-}" \
    -H "x-agent-ts: $ts" -H "x-agent-sign: $sign" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>/dev/null || true
}

TOK=$(timeout 20 curl -s -X POST "$API/auth/login" -H "x-api-key: $AK" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EM\",\"password\":\"$PW\"}" | grep -oE '"accessToken":"[^"]+"' | cut -d'"' -f4)
[ -z "$TOK" ] && { log "HATA: giris basarisiz"; notify "canary: API girisi basarisiz"; exit 1; }

NAME="canary-$(date +%H%M%S)"
RESP=$(timeout 30 curl -s -X POST "$API/provision/create" -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" \
  -H 'Content-Type: application/json' -d "{\"name\":\"$NAME\",\"proxyCountry\":\"$CC\"}")
DEV=$(echo "$RESP" | grep -oE '"deviceId":"[^"]+"' | cut -d'"' -f4)
INST=$(echo "$RESP" | grep -oE '"instance":"[^"]+"' | cut -d'"' -f4)
JOB=$(echo "$RESP" | grep -oE '"jobId":"[^"]+"' | cut -d'"' -f4)
[ -z "$INST" ] && { log "HATA: provision baslatilamadi: $(echo "$RESP" | head -c 200)"; notify "canary: provision baslatilamadi"; exit 1; }
log "canary basladi: $NAME ($INST, $CC)"

# Cihazi HER durumda sil (basarili da olsa, patlasa da) — kalinti birakma.
# ★★KRITIK: KURULUM SURERKEN SILME. Ilk surumde silme kosulsuzdu ve script erken cikinca
# cihaz KURULUMUN ORTASINDA silindi -> agent'in devam eden provision'i yarim kalan dizinde
# patladi ("instance data dizini yok", Magisk FAIL, boot TIMEOUT) ve sonraki canary ayni
# instance adina cakisti. Once isin TERMINAL duruma gelmesini bekle (max ~4dk), sonra sil.
cleanup() {
  [ -z "${DEV:-}" ] && return 0
  if [ -n "${JOB:-}" ]; then
    for _ in $(seq 1 48); do
      S=$(timeout 15 curl -s "$API/provision/status/$JOB" -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" \
          | grep -oE '"status":"[^"]+"' | head -1 | cut -d'"' -f4)
      case "$S" in COMPLETED|FAILED|CANCELLED|"") break ;; esac
      sleep 5
    done
  fi
  timeout 40 curl -s -o /dev/null -X DELETE "$API/devices/$DEV" \
    -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" 2>/dev/null || true
  log "canary temizlendi ($INST)"
}
trap cleanup EXIT

# Kurulumun bitmesini bekle (max 5 dk).
# ⚠️ Agent LOGUNU grep'leme! Ilk surumde "DONE <inst>" araniyordu ve instance adlari geri
# donusumlu oldugu icin AYNI GUNUN eski kurulumundan kalma satir esleserek canary'yi
# 5 saniyede "hazir" sandi -> cihaz daha boot ederken kontrol edildi -> YANLIS ALARM.
# Tek dogru kaynak: is durumu API'si (jobId'ye bagli, gecmise karismaz).
# ★2026-09-03 net-head cagrisi buradan 140. satira (tembel, kurulum SONRASI) tasindi:
# kurulumdan once cagirmak canary'nin kendisine subnet TAHSIS ETTIRIYORDU (sorgu degil).
# ★2026-08-15 IKI HATA DUZELTILDI (canary HER TUR yalanci alarm veriyordu:
# "DNS-YOK internet-cikis(TCP=) ulke=BOS" -- oysa cihaz saglamdi):
#  (1) ".112 VARSAYIMI": DHCP cihaza .112 DISINDA adres verebiliyor (13 Agu'da ayni
#      varsayim health-watch'ta 98 gereksiz restart yaptirmisti). Artik gercek IP
#      DHCP lease dosyasindan okunur; .112 yalnizca son care fallback.
#  (2) "adb connect YOK": script hic connect yapmadan `adb -s IP:5555 shell`
#      cagiriyordu -> her komut BOS donuyordu (kanit: TCP= bos, DNS-YOK, ulke=BOS).
READY=0
for i in $(seq 1 60); do
  sleep 5
  ST=$(timeout 15 curl -s "$API/provision/status/$JOB" -H "x-api-key: $AK" -H "Authorization: Bearer $TOK" \
       | grep -oE '"status":"[^"]+"' | head -1 | cut -d'"' -f4)
  [ "$ST" = "COMPLETED" ] && { READY=1; break; }
  case "$ST" in FAILED|CANCELLED) log "kurulum $ST"; break ;; esac
done
[ "$READY" != "1" ] && { log "BASARISIZ: kurulum tamamlanmadi (son durum=${ST:-bilinmiyor})"; notify "canary: kurulum tamamlanmadi/${ST:-?} ($INST)"; exit 1; }
sleep 3   # READY isaretlendikten sonra ADB'nin oturmasi icin kisa pay

# ★GERCEK IP: dnsmasq'in bu instance'a verdigi son DHCPACK (journal). Lease DOSYASI
# canary omru boyunca olusmuyor (cihaz silinince dnsmasq yazmadan gidiyor), bu yuzden
# journal tek guvenilir kaynak. KANIT: mi327 .65 aldi, canary .112'ye bakip "DNS-YOK
# internet-YOK" dedi — oysa cihaz SAGLAMDI (API de .65'i gormustu).
IP=""
for _t in 1 2 3 4 5 6 7 8 9 10; do
  IP=$(journalctl --since "-10 min" --no-pager 2>/dev/null \
       | grep -oE "DHCPACK\(waydroid-${INST}\) [0-9.]+" | tail -1 | awk '{print $2}')
  [ -n "$IP" ] && break
  sleep 3
done
[ -z "$IP" ] && IP=$(awk '{print $3}' "/var/lib/misc/dnsmasq.waydroid-${INST}.leases" 2>/dev/null | tail -1)
if [ -z "$IP" ]; then SUB=$(sh /opt/fleet-agent/waydroid/net-head.sh "$INST" 2>/dev/null); [ -n "$SUB" ] && IP="192.168.${SUB}.112"; fi
log "canary cihaz IP=$IP (instance=$INST)"

# ── DOGRULAMALAR ────────────────────────────────────────────────────────────
FAILS=""
timeout 10 adb connect "$IP:5555" >/dev/null 2>&1 || true   # ★SART: connect olmadan shell BOS doner
sleep 2
adbsh() { timeout 25 adb -s "$IP:5555" shell "$1" 2>/dev/null | tr -d '\r'; }

# 1) internete cikis (DNS-siz ham TCP)
TCP=$(adbsh "su -c 'curl -s -o /dev/null -w %{http_code} --max-time 10 http://1.1.1.1'")
[ "$TCP" = "301" ] || [ "$TCP" = "200" ] || FAILS="$FAILS internet-cikis(TCP=$TCP)"

# 2) DNS yapilandirildi mi (isim cozumunun ON KOSULU — 2026-07-28 hatasi tam buydu)
DNS=$(adbsh "dumpsys connectivity" | grep -oE 'DnsAddresses: \[[^]]*\]' | head -1)
case "$DNS" in *192.168*) : ;; *) FAILS="$FAILS DNS-YOK" ;; esac

# 3) isim cozumu GERCEKTEN calisiyor mu + WhatsApp erisilebilir mi
WA=$(adbsh "su -c 'curl -sk -o /dev/null -w %{http_code} --max-time 15 https://web.whatsapp.com'")
[ "$WA" = "200" ] || FAILS="$FAILS whatsapp-erisim(HTTP=$WA)"

# 4) proxy ULKESI istenenle eslesiyor mu (uyusmazlik = WhatsApp ban riski)
GEO=$(adbsh "su -c 'curl -s --max-time 15 -H \"Host: ipinfo.io\" http://34.117.59.81/json'" | grep -oE '"country": *"[A-Z]{2}"' | grep -oE '[A-Z]{2}' | head -1)
[ "$GEO" = "$CC" ] || FAILS="$FAILS ulke-uyusmazligi(beklenen=$CC gercek=${GEO:-BOS})"

if [ -n "$FAILS" ]; then
  log "★BASARISIZ:$FAILS"
  notify "canary BASARISIZ:$FAILS"
  exit 1
fi
log "OK: kurulum+DNS+cikis+WhatsApp+ulke($GEO) dogrulandi"
exit 0

# ── KURULUM (systemd timer, gunde 1) ────────────────────────────────────────
#  /etc/systemd/system/wd-canary.service
#    [Unit] Description=Fleet canary (uctan uca kurulum dogrulamasi)
#    [Service] Type=oneshot
#    ExecStart=/bin/bash /opt/fleet-agent/waydroid/wd-canary.sh TR
#  /etc/systemd/system/wd-canary.timer
#    [Unit] Description=Gunluk fleet canary
#    [Timer] OnCalendar=*-*-* 04:30:00
#            Persistent=true
#    [Install] WantedBy=timers.target
#  systemctl daemon-reload && systemctl enable --now wd-canary.timer
