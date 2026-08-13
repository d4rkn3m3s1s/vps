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
WD_RUN="/opt/fleet-agent/waydroid/wd-run.sh"   # zombie instance restart (self-heal)
LOG="/var/log/wd-health-watch.log"
ADB="${FLEET_ADB:-/usr/bin/adb}"
# Host'un kendi (datacenter) çıkış IP'si — bir cihaz BUNDAN çıkıyorsa proxy sızmış demektir.
DC_IP="$(timeout 8 curl -s https://api.ipify.org 2>/dev/null || echo '')"

# API bildirimi için agent kimlik bilgileri (agent.env ile aynı).
API_URL="${FLEET_API_URL:-http://127.0.0.1:4000}"
API_KEY="${FLEET_API_KEY:-}"
HOST_KEY="${FLEET_HOST_KEY:-}"

# Proxy hesapları (env; wd-proxy-restore ile aynı, /etc/fleet-proxy.env).
# ★ `.pr` RESMİ endpoint (`.eu` DEĞİL). `.eu` kısmen çalışır ama ~%15 istekte
# `Resource_203 / "resource IP is incorrect"` → 502 döner (ölçüm: eu 34/40, pr 40/40).
H="${FLEET_PROXY_HOST:-ncx9yhrx.pr.thordata.net}"
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

# Bir instance'ın Android ADB adresini bul.
# ★★★2026-08-13 ".112 varsayımı" sağlam cihazları ZOMBIE sanıp yeniden başlatıyordu —
# ayrıntılı gerekçe ve A/B kanıtı için deploy/kvm-host/wd-health-watch.sh içindeki
# aynı fonksiyonun yorumuna bakın. Adres artık container'ın eth0'ından OKUNUR.
adb_addr_for() {
  local inst="$1" sn ip
  ip=$(lxc-attach -n waydroid -P "/var/lib/waydroid.$inst/lxc" -- /system/bin/ip -4 addr show eth0 2>/dev/null \
       | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
  if echo "$ip" | grep -qE '^192\.168\.[0-9]+\.[0-9]+$'; then echo "$ip:5555"; return; fi
  sn=$(grep -w "$inst" /var/lib/waydroid-subnets.map 2>/dev/null | awk '{print $2}')
  [ -z "$sn" ] && { echo ""; return; }
  ip=$(grep -h "192\.168\.$sn\." "/var/lib/misc/waydroid-$inst.leases" 2>/dev/null | awk '{print $3}' | head -1)
  if echo "$ip" | grep -qE '^192\.168\.[0-9]+\.[0-9]+$'; then echo "$ip:5555"; return; fi
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
  # ★ADB-CONNECT (2026-07-23): önce bir kez connect dene — bir instance boot etse bile
  # ADB otomatik bağlanmaz (KANITLANDI: recovery sonrası cihazlar 'device' değil ta ki
  # 'adb connect' yapılana dek). Bu, boot-eden cihazın gereksiz zombie-restart'ını önler.
  "$ADB" connect "$addr" >/dev/null 2>&1 || true
  if ! timeout 12 "$ADB" -s "$addr" shell 'echo ok' </dev/null 2>/dev/null | grep -q ok; then
    "$ADB" disconnect "$addr" >/dev/null 2>&1 || true
    "$ADB" connect "$addr" >/dev/null 2>&1 || true
    sleep 2
    if timeout 12 "$ADB" -s "$addr" shell 'echo ok' </dev/null 2>/dev/null | grep -q ok; then
      log "🔄 $inst: erişilemiyordu → adb reconnect BAŞARILI"
      notify AUTO_RECONNECT "$inst" "Cihaz ADB'den erişilemiyordu, otomatik yeniden baglandi" true
      RECONN=$((RECONN+1))
    else
      # ★ZOMBIE-TESPİT + INSTANCE-RESTART: adb reconnect YETMEDİ. Uzun-çalışan Waydroid
      # instance'ları zamanla İÇERİDEN çöküyor (Android donuyor: ADB-daemon ölü + ping
      # kayıp) ama host-wrapper (wd-run.sh/weston) ayakta kalıyor → "zombie". adb
      # reconnect bağlanacak bir daemon bulamaz. TEK çözüm instance'ı taze boot etmek.
      # KANITLANDI: mi68 + mi7 aynı şekilde çöktü, sadece reconnect kurtaramadı.
      # Şart: host-wrapper AYAKTA (wd-run.sh $inst süreci var) → gerçekten bu instance,
      # yeni provision değil. wd-run zombie'yi temizleyip Android'i sıfırdan boot eder.
      if pgrep -f "wd-run.sh $inst" >/dev/null 2>&1 || pgrep -f "waydroid.*$inst\|lxc-start.*waydroid.$inst" >/dev/null 2>&1; then
        # ★BOOT-GRACE (2026-07-23): bir instance BOOT ederken (henüz ~90s dolmamış) ADB'den
        # erişilemez — bu ZOMBIE DEĞİL, sadece boot bitmemiş. Onu zombie sanıp yeniden
        # başlatmak, boot eden instance'ın ÜSTÜNE İKİNCİ bir wd-run başlatır → DUPLICATE
        # wd-run → aynı binder/DBus runtime'ında çakışma → İKİSİ DE bozulur (KANITLANDI:
        # 33 wd-run + 14 cihaz düştü). Bu yüzden: wd-run.sh $inst süreci son BOOT_GRACE_S
        # saniye içinde başlamışsa BEKLE, dokunma. mtime ile yaşını ölç (process start).
        BOOT_GRACE_S="${WD_BOOT_GRACE_S:-150}"
        wr_pid=$(pgrep -f "wd-run.sh $inst\$" 2>/dev/null | head -1)
        if [ -n "$wr_pid" ]; then
          wr_age=$(($(date +%s) - $(stat -c %Y "/proc/$wr_pid" 2>/dev/null || echo 0)))
          if [ "$wr_age" -lt "$BOOT_GRACE_S" ]; then
            log "⏳ $inst: boot sürüyor (wd-run ${wr_age}s < ${BOOT_GRACE_S}s) → zombie-restart ATLANDI, bekleniyor"
            continue
          fi
        fi
        # ★LOAD-GATE (2026-07-23, P-3): a zombie-restart boots a fresh Android → CPU spike.
        # If the host is ALREADY saturated (load ≥ cores*0.9), starting another boot deepens
        # a load-100 storm and makes the boot itself crawl/fail. Skip this instance THIS tick;
        # the next run (~7min) retries once load has dropped. Uses /proc/loadavg (cheap).
        _load1=$(awk '{print int($1)}' /proc/loadavg 2>/dev/null || echo 0)
        _load_max=$(awk -v n="$(nproc)" 'BEGIN{printf "%.0f", n*0.9}')
        if [ "${_load1:-0}" -ge "${_load_max:-999}" ]; then
          log "⏸ $inst: zombie ama host yükü yüksek (load=$_load1 ≥ $_load_max) → restart ERTELENDİ (sonraki tur)"
          continue
        fi
        log "🧟 $inst: ADB reconnect başarısız + host-süreç ayakta = ZOMBIE → runtime temizlenip yeniden başlatılıyor"
        # ★TAM RUNTIME TEMİZLİĞİ ŞART, sonra wd-run. Sadece wd-run.sh çağırmak YETMEZ:
        # bir zombie'de asılı bir lxc-start ve BOZUK DBus soketi kalır; wd-run yeni boot'u
        # başlatsa da container o bozuk runtime'a bağlanamaz ve ~30s sonra kendini durdurur
        # ("Terminating session because the container was stopped" + DBus Disconnected).
        # KANITLANDI (mi7): asılı lxc-start + /run/xdg-mi7 DBus kalıntısı boot'u engelledi;
        # bunları silince temiz boot etti. Öldür → runtime sil → taze wd-run.
        # ★DUPLICATE-GUARD (2026-07-23): ESKİ wd-run.sh $inst wrapper'ını da öldür — yoksa
        # eski + yeni wd-run aynı anda çalışıp çakışır (bu oturumun ana bug'ı).
        pkill -9 -f "wd-run.sh $inst\$" 2>/dev/null || true
        pkill -9 -f "wayland-$inst" 2>/dev/null || true
        pkill -9 -f "xdg-$inst" 2>/dev/null || true
        pkill -9 -f "waydroid.*--instance $inst" 2>/dev/null || true
        pkill -9 -f "lxc-start.*waydroid.$inst" 2>/dev/null || true
        pkill -9 -f "dnsmasq.*waydroid-$inst" 2>/dev/null || true
        lxc-stop -n waydroid -P "/var/lib/waydroid.$inst/lxc" -k 2>/dev/null || true
        rm -rf "/run/xdg-$inst" "/run/wd-$inst" "/run/waydroid-$inst-lxc" 2>/dev/null || true
        sleep 3
        # setsid + arka plan: wd-run uzun sürer (~90s boot), bu döngüyü bloklamasın.
        setsid bash "$WD_RUN" "$inst" >/dev/null 2>&1 < /dev/null &
        notify AUTO_RECONNECT "$inst" "Instance cokmustu (zombie) - runtime temizlenip yeniden baslatildi" true
        RECONN=$((RECONN+1))
        continue  # boot devam ediyor; proxy'yi bir sonraki tur (cihaz ONLINE olunca) uygular
      else
        log "✗ $inst: erişilemiyor, reconnect başarısız (host-wrapper da yok)"
        notify UNREACHABLE "$inst" "Cihaz ADB'den erişilemiyor, reconnect basarisiz" false
        UNREACH=$((UNREACH+1))
        continue
      fi
    fi
  fi

  # 2) Gerçek çıkış-IP'yi Android İÇİNDEN al (app-UID → redsocks; root curl proxy'yi baypaslar).
  # ★2026-07-27 KOK-FIX: eski test HTTPS api.ipify.org (TLS-handshake redsocks uzerinden
  # YAVAS, 15s'de gelmiyordu → exit_ip BOS → yanlis "olu/sizinti" tespiti → 12 cihaz her
  # turda GEREKSIZ restart → redsocks dalgalanmasi + bildirim SPAM'i. Cihazlar aslinda
  # SAGLAM (mi3: TCP 301, cikis-IP 94.55.x TR). FIX: HTTP (TLS yok, hizli) + 2 deneme.
  exit_ip=""
  for _try in 1 2; do
    exit_ip="$(timeout 18 "$ADB" -s "$addr" shell 'curl -s --max-time 14 http://api.ipify.org' </dev/null 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    [ -n "$exit_ip" ] && break
    # HTTP ipify gelmezse HTTP ifconfig.me dene (farkli saglayici)
    exit_ip="$(timeout 18 "$ADB" -s "$addr" shell 'curl -s --max-time 14 http://ifconfig.me/ip' </dev/null 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
    [ -n "$exit_ip" ] && break
  done
  if [ -z "$exit_ip" ]; then
    # ★DEAD-REDSOCKS (2026-07-23): çıkış-IP hiç gelmiyor olabilir çünkü instance'ın
    # redsocks'u ÖLÜ (recovery/reboot sonrası config+process kaybolur; iptables trafiği
    # o instance'ın portuna yönlendirir ama dinleyen yoktur → tüm HTTP kara deliğe gider,
    # ping çalışır ama curl boş). KANITLANDI (mi9): redsocks-inst-5 yok, port 12505
    # dinlemiyordu. TESPİT: instance'ın redsocks portu (12500+subnetId) dinlemiyorsa +
    # cihaz ağ olarak canlıysa (ping) → proxy ÖLÜ, yeniden uygula. Aksi halde geçici say.
    sn=$(grep -w "$inst" /var/lib/waydroid-subnets.map 2>/dev/null | awk '{print $2}')
    rport=$((12500 + ${sn:-0}))
    net_alive="$(timeout 12 "$ADB" -s "$addr" shell 'ping -c1 -W2 8.8.8.8 >/dev/null 2>&1 && echo up' </dev/null 2>/dev/null | grep -c up)"
    if [ -n "$sn" ] && ! ss -tlnH "sport = :$rport" 2>/dev/null | grep -q ":$rport" && [ "${net_alive:-0}" != "0" ]; then
      log "⚠ $inst: REDSOCKS ÖLÜ (port $rport dinlemiyor, ağ canlı) → proxy yeniden uygulanıyor (cc=${cc:-?})"
      if [ -n "$cc" ]; then
        if is_mobile_cc "$cc"; then U="$U_MOB"; P="$P_MOB"; PORT="$PORT_MOB"; else U="$U_RES"; P="$P_RES"; PORT="$PORT_RES"; fi
        r=$(bash "$WP" "$inst" "$cc" "$U" "$P" "$H" "$PORT" 2>&1 | grep -oE 'PROXY_RESULT.*redsocks=[0-9]+|PROXY_FAIL.*' | head -1)
        if echo "$r" | grep -q PROXY_RESULT; then
          log "  ✓ $inst: ölü redsocks yeniden başlatıldı ($cc)"
          log "[bildirim-susturuldu] PROXY_DEAD $inst" #notify PROXY_DEAD "$inst" "Redsocks olmustu (port $rport), $cc proxy yeniden uygulandi" true
          LEAK=$((LEAK+1))
        else
          log "  ✗ $inst: redsocks yeniden başlatılamadı: ${r:-no-result}"
          log "[bildirim-susturuldu] PROXY_DEAD $inst" #notify PROXY_DEAD "$inst" "Redsocks olu (port $rport), yeniden baslatilamadi" false
        fi
      else
        log "  ✗ $inst: ülke bilinmiyor, ölü redsocks düzeltilemiyor"
        log "[bildirim-susturuldu] PROXY_DEAD $inst" #notify PROXY_DEAD "$inst" "Redsocks olu (port $rport), ulke bilinmedigi icin duzeltilemedi" false
      fi
    else
      log "? $inst: çıkış-IP alınamadı (geçici olabilir)"
    fi
    continue
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
# ★2026-07-23 (M-3): dead-man's-switch heartbeat. Report "I ran" so the API can detect if
# this monitor ever stops (env/DB failure → silent exit). The API stamps Host.lastHealthWatchAt
# and alerts if it goes >20min stale. Best-effort; never blocks the run.
notify HEALTH_WATCH_HEARTBEAT "" "health-watch turu tamamlandi ($OK saglikli, $LEAK sizinti, $RECONN reconnect)" true
exit 0
