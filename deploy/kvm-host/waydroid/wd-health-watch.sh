#!/usr/bin/env bash
# wd-health-watch.sh — PROAKTİF SAĞLIK İZLEME + OTO-İYİLEŞME (systemd timer, ~7 dk).
#
# Ban olmadan ÖNCE yakala: her aktif/kısıtlı WhatsApp cihazının GERÇEK çıkış-IP'sini
# (Android içinden, app-UID trafiği ile) kontrol eder.
#   • Çıkış-IP host'un DATACENTER IP'sine (proxy sızıntısı) → proxy'yi YENİDEN uygula.
#   • Cihaz ADB'den erişilemiyor → adb reconnect dene (oto-iyileşme).
# Her düzeltmeyi/sızıntıyı API'ye bildirir (POST /agent/health-alert) → operatöre
# Telegram/webhook uyarısı gider. wd-proxy-restore.sh ile aynı DB kaynağı + proxy mantığı.
set -uo pipefail

WP="/opt/fleet-agent/waydroid/wd-proxy.sh"
LOG="/var/log/wd-health-watch.log"
ADB="${FLEET_ADB:-/usr/bin/adb}"
# Host'un kendi (datacenter) çıkış IP'si — bir cihaz BUNDAN çıkıyorsa proxy sızmış demektir.
DC_IP="$(timeout 8 curl -s https://api.ipify.org 2>/dev/null || echo '')"

# API bildirimi için agent kimlik bilgileri (agent.env ile aynı).
API_URL="${FLEET_API_URL:-http://127.0.0.1:4000}"
API_KEY="${FLEET_API_KEY:-}"
HOST_KEY="${FLEET_HOST_KEY:-}"

# Proxy hesapları (env; wd-proxy-restore ile aynı, /etc/fleet-proxy.env).
H="${FLEET_PROXY_HOST:-ncx9yhrx.eu.thordata.net}"
U_RES="${FLEET_PROXY_USER:-}"; P_RES="${FLEET_PROXY_PASS:-}"; PORT_RES="${FLEET_PROXY_PORT:-5555}"
U_MOB="${FLEET_PROXY_MOBILE_USER:-$U_RES}"; P_MOB="${FLEET_PROXY_MOBILE_PASS:-$P_RES}"
PORT_MOB="${FLEET_PROXY_MOBILE_PORT:-9999}"
MOBILE_CCS=" $(echo "${FLEET_PROXY_MOBILE_COUNTRIES:-TR}" | tr ',' ' ' | tr '[:lower:]' '[:upper:]') "

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
is_mobile_cc() { case "$MOBILE_CCS" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# API'ye sağlık uyarısı gönder (best-effort, script'i asla bloklamaz).
notify() { # kind instance detail fixed
  [ -z "$API_KEY" ] && return 0
  local kind="$1" inst="$2" detail="$3" fixed="${4:-false}"
  timeout 10 curl -s -o /dev/null -X POST "$API_URL/agent/health-alert" \
    -H "x-api-key: $API_KEY" -H "x-agent-key: $HOST_KEY" -H 'Content-Type: application/json' \
    -d "{\"kind\":\"$kind\",\"instance\":\"$inst\",\"detail\":\"$detail\",\"fixed\":$fixed}" 2>/dev/null || true
}

if [ -z "$U_RES" ]; then log "HATA: FLEET_PROXY_USER boş (env yüklenmedi) — izleme güvenli değil, DURDU"; exit 1; fi

# Aktif/kısıtlı WA cihazlarını al: instance | proxyCountry(ISO, öncelikli) | phone.
SQL="SELECT d.metadata->>'instance',
            COALESCE(d.metadata->>'proxyCountry',''),
            COALESCE(g.\"phoneNumber\",'')
     FROM \"Device\" d
     LEFT JOIN \"GeneratedAccount\" g
       ON g.\"deviceId\"=d.id AND g.platform='whatsapp'
          AND g.status IN ('ACTIVE','RESTRICTED','AWAITING_OTP','AWAITING_MANUAL')
     WHERE d.metadata->>'instance' IS NOT NULL
       AND ( g.id IS NOT NULL OR (d.metadata->>'proxyCountry') IS NOT NULL )"
ROWS=$(docker exec -i fleet-postgres psql -U postgres -d fleet -t -A -F'|' -c "$SQL")
RC=$?
if [ "$RC" -ne 0 ]; then log "HATA: DB sorgusu başarısız (rc=$RC) — izleme atlandı"; exit 1; fi
ROWS=$(echo "$ROWS" | grep -v '^$')
[ -z "$ROWS" ] && { log "aktif-WA cihazı yok — atlanıyor"; exit 0; }

# Bir instance'ın Android ADB adresini bul (subnet map + .112:5555).
adb_addr_for() {
  local inst="$1" sn
  sn=$(grep -w "$inst" /var/lib/waydroid-subnets.map 2>/dev/null | awk '{print $2}')
  [ -z "$sn" ] && { echo ""; return; }
  echo "192.168.$sn.112:5555"
}

OK=0; LEAK=0; RECONN=0; UNREACH=0
declare -A DONE
while IFS='|' read -r inst meta_cc phone; do
  [ -z "$inst" ] && continue
  [ -n "${DONE[$inst]:-}" ] && continue
  DONE[$inst]=1
  addr="$(adb_addr_for "$inst")"
  [ -z "$addr" ] && { log "⤼ $inst: subnet bilinmiyor, atla"; continue; }

  # Ülkeyi çöz (proxyCountry öncelikli).
  cc="$(echo "$meta_cc" | tr '[:lower:]' '[:upper:]')"
  echo "$cc" | grep -qE '^[A-Z]{2}$' || cc=""

  # 1) Cihaz ADB'den erişilebilir mi? Değilse reconnect dene (oto-iyileşme).
  # NOTE: `</dev/null` on every adb shell — otherwise adb consumes the while-loop's
  # stdin (the ROWS heredoc) and the loop stops after the first device (classic bash
  # trap; this is exactly why the first run only processed mi15).
  if ! timeout 12 "$ADB" -s "$addr" shell 'echo ok' </dev/null 2>/dev/null | grep -q ok; then
    "$ADB" disconnect "$addr" >/dev/null 2>&1 || true
    "$ADB" connect "$addr" >/dev/null 2>&1 || true
    sleep 2
    if timeout 12 "$ADB" -s "$addr" shell 'echo ok' </dev/null 2>/dev/null | grep -q ok; then
      log "🔄 $inst: erişilemiyordu → adb reconnect BAŞARILI"
      notify AUTO_RECONNECT "$inst" "Cihaz ADB'den erişilemiyordu, otomatik yeniden baglandi" true
      RECONN=$((RECONN+1))
    else
      log "✗ $inst: erişilemiyor, reconnect başarısız"
      notify UNREACHABLE "$inst" "Cihaz ADB'den erişilemiyor, reconnect basarisiz" false
      UNREACH=$((UNREACH+1))
      continue
    fi
  fi

  # 2) Gerçek çıkış-IP'yi Android İÇİNDEN al (app-UID → redsocks; root curl proxy'yi baypaslar).
  exit_ip="$(timeout 20 "$ADB" -s "$addr" shell 'curl -s --max-time 15 https://api.ipify.org' </dev/null 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  if [ -z "$exit_ip" ]; then
    log "? $inst: çıkış-IP alınamadı (geçici olabilir)"; continue
  fi

  # 3) DATACENTER sızıntısı mı? (cihaz host'un IP'sinden çıkıyorsa proxy düşmüş = ban riski)
  if [ -n "$DC_IP" ] && [ "$exit_ip" = "$DC_IP" ]; then
    LEAK=$((LEAK+1))
    log "⚠ $inst: PROXY SIZINTISI — çıkış=$exit_ip (datacenter!) → proxy yeniden uygulanıyor (cc=${cc:-?})"
    if [ -n "$cc" ]; then
      if is_mobile_cc "$cc"; then U="$U_MOB"; P="$P_MOB"; PORT="$PORT_MOB"; else U="$U_RES"; P="$P_RES"; PORT="$PORT_RES"; fi
      r=$(bash "$WP" "$inst" "$cc" "$U" "$P" "$H" "$PORT" 2>&1 | grep -oE 'PROXY_RESULT.*redsocks=[0-9]+|PROXY_FAIL.*' | head -1)
      if echo "$r" | grep -q PROXY_RESULT; then
        log "  ✓ $inst: proxy yeniden uygulandı ($cc)"
        notify PROXY_LEAK "$inst" "Datacenter IP'ye dusmustu ($exit_ip), $cc proxy yeniden uygulandi" true
      else
        log "  ✗ $inst: proxy yeniden uygulanamadı: ${r:-no-result}"
        notify PROXY_LEAK "$inst" "Datacenter IP sizintisi ($exit_ip), proxy DUZELTILEMEDI" false
      fi
    else
      log "  ✗ $inst: ülke bilinmiyor, proxy yeniden uygulanamıyor"
      notify PROXY_LEAK "$inst" "Datacenter IP sizintisi ($exit_ip), ulke bilinmedigi icin duzeltilemedi" false
    fi
  else
    OK=$((OK+1))
  fi
done <<< "$ROWS"

log "TAMAM: $OK sağlıklı, $LEAK sızıntı-düzeltildi, $RECONN reconnect, $UNREACH erişilemez"
exit 0
