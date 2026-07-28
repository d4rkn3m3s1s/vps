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
notify() { # detay
  [ -z "$AK" ] && return 0
  timeout 12 curl -s -o /dev/null -X POST "$API/agent/health-alert" \
    -H "x-api-key: $AK" -H "x-agent-key: ${HK:-}" -H 'Content-Type: application/json' \
    -d "{\"kind\":\"CANARY_FAILED\",\"instance\":\"canary\",\"detail\":\"$1\",\"fixed\":false}" 2>/dev/null || true
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
SUB=$(sh /opt/fleet-agent/waydroid/net-head.sh "$INST" 2>/dev/null)
IP="192.168.${SUB}.112"
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

# ── DOGRULAMALAR ────────────────────────────────────────────────────────────
FAILS=""
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
