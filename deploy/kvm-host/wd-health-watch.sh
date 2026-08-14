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


# ── ★2026-07-29: ÇIKIŞ-ÖLÜ KADEMELİ KURTARMA (ROTATE_MARK_20260729) ───────────────
#
# NEDEN: bu script iki arıza tipini yakalıyordu — datacenter sızıntısı ve ÖLÜ redsocks.
# Ama üçüncü bir tip vardı ve GÖRÜNMÜYORDU: redsocks AYAKTA, ağ CANLI, ama upstream
# proxy 502 dönüyor (thordata'nın o ÜLKE havuzu bozuk). O durumda kod "çıkış-IP
# alınamadı (geçici olabilir)" deyip geçiyordu; cihaz OK sayacına bile girmiyordu.
# CANLI KANIT (29 Tem): 21 cihaz WhatsApp'a çıkamazken script "38 sağlıklı" raporladı —
# yani düşerse gerçekten fark edemiyorduk. Kök: residential hesabın country-TR havuzu
# 502 veriyordu (hesap değil, ÜLKE HAVUZU bozuk; mobile hesap aynı anda TR'yi veriyordu).
#
# Kademeli kurtarma:
#   1) sessid'i döndür  → aynı hesapta yeni oturum (bugün 5 cihaz böyle kurtarıldı)
#   2) hesabı değiştir  → o ülkeyi VEREN diğer hesabı host'tan doğrula, çalışıyorsa oraya al
#   3) alarm            → ikisi de olmazsa; filo eşiği (3+) aşılırsa TEK özet bildirim

# Upstream'i HOST'tan dene: bu ülke, bu hesapla gerçekten çıkabiliyor mu?
#
# ★2026-08-05 BU TEST YALAN SÖYLÜYORDU (canlı: mi46, 228 restart / 258 ZOMBIE).
# Eski hâli `http://1.1.1.1` (düz IP, düz HTTP) çekiyordu. Bu istek proxy'nin
# ÇIKIŞ havuzunu gerçekten kullanmıyor — upstream düz-IP'ye 301 döndürüp testi
# GEÇİRİYOR, ama aynı kombinasyonla gerçek (HTTPS + isim çözümlemeli) trafik
# ÖLÜ. ÖLÇÜLDÜ: residential+TR → 1.1.1.1 testi geçer, ipinfo.io HTTPS = 000.
# (28 Tem'deki "DNS'siz cihaz TCP 301 döner ONLINE görünür" tuzağının aynısı.)
#
# Sonuç: script "bu hesap TR veriyor" sanıp config'i EZİYOR, cihaz çıkamıyor,
# bir sonraki turda yine deniyor → sonsuz döngü + operatörün elle düzeltmesi de
# 11 saniye içinde geri alınıyordu.
#
# Artık HTTPS + isim çözümlemesi gerektiren gerçek bir uç nokta kullanıyoruz:
# CONNECT tüneli kurulamıyorsa (000/403/502) havuz gerçekten ölüdür.
upstream_ok() { # user pass port cc sessid
  local u="$1" p="$2" port="$3" cc="$4" sid="$5" code
  code=$(timeout 20 curl -s -o /dev/null -w '%{http_code}' \
    -x "http://${u}-country-${cc}-sessid-${sid}-sesstime-30:${p}@${H}:${port}" \
    https://ipinfo.io/json 2>/dev/null)
  case "$code" in 200) return 0 ;; *) return 1 ;; esac
}

# ★2026-08-05 ÜLKE↔PORT UYUMU. thordata'da iki ayrı hesap var ve ülke havuzları
# ÖRTÜŞMÜYOR: TR yalnızca mobile(9999) havuzunda, AL/US/GB residential(5555)'te
# (29 Tem'de ölçüldü: residential country-TR → 502). Bir ülkeyi YANLIŞ porttan
# istemek KALICI olarak başarısızdır — sessid rotasyonu da hesap değiştirme de
# bunu düzeltemez, çünkü sorun oturumda değil havuzda.
#
# mi46 tam bu duruma düşmüştü: TR isterken residential(5555)'e bağlıydı.
# Bu yüzden kurtarma denemeden ÖNCE eşleşmeyi doğruluyoruz.
cc_port_ok() { # cc port
  local cc="$1" port="$2"
  if is_mobile_cc "$cc"; then [ "$port" = "$PORT_MOB" ]; else [ "$port" = "$PORT_RES" ]; fi
}

# Bir instance'ın redsocks config'inde YAZILI upstream portu (5555/9999).
# `local_port` de "port" ile eşleştiği için son eşleşmeyi alıyoruz — upstream
# port satırı config'te local_port'tan SONRA gelir.
inst_upstream_port() { # inst
  local f="/etc/redsocks-inst-$1.conf"
  [ -f "$f" ] || return 1
  grep -E '^[[:space:]]*port[[:space:]]*=' "$f" 2>/dev/null | grep -oE '[0-9]+' | tail -1
}

# wd-proxy.sh'ı ÖZEL bir sessid ile çağır. wd-proxy login'de zaten "-sessid-" varsa
# dokunmuyor (bkz. wd-proxy.sh case bloğu), bu yüzden kullanıcı adına hazır sessid
# gömerek rotasyonu ona yaptırabiliyoruz.
apply_with_sessid() { # inst cc user pass port sessid
  local inst="$1" cc="$2" u="$3" p="$4" port="$5" sid="$6" r sn rport
  r=$(bash "$WP" "$inst" "$cc" "${u}-country-${cc}-sessid-${sid}" "$p" "$H" "$port" 2>&1 \
      | grep -oE 'PROXY_RESULT.*redsocks=[0-9]+|PROXY_FAIL.*' | head -1)
  echo "$r" | grep -q PROXY_RESULT || return 1

  # ★SINGLEAPPLY_MARK_20260729: "PROXY_RESULT" tek basina YETMEZ — redsocks GERÇEKTEN
  # ayakta mı? (KANIT/mi32: wd-proxy PROXY_RESULT döndürdü ama daemon ölmüştü →
  # port dinlemiyordu, cihaz kopuk kaldı, script "kurtarıldı" sandı.)
  #
  # ⚠️ AYNI KOMUTU TEKRAR ÇAĞIRMA: wd-proxy.sh her çağrıda önce mevcut redsocks'u
  # `pkill` ile ÖLDÜRÜP yeniden başlatır (wd-proxy.sh:128). Arka arkaya iki çağrı,
  # birincinin yeni başlattığı daemon'ı öldürüp yerine koyamıyor → kalıcı kopukluk.
  # (Bu, ilk denememde tam olarak yaşandı.) Bu yüzden: TEK uygulama + doğrulama;
  # tutmazsa başarısız dön, çağıran bir SONRAKİ adıma (hesap değiştirme) geçsin.
  sn=$(grep -w "$inst" /var/lib/waydroid-subnets.map 2>/dev/null | awk '{print $2}')
  [ -z "$sn" ] && return 0   # subnet bilinmiyor: doğrulayamayız, PROXY_RESULT'a güven
  rport=$((12500 + sn))
  for _w in 1 2 3 4 5; do
    ss -tlnH "sport = :$rport" 2>/dev/null | grep -q ":$rport" && return 0
    sleep 1
  done
  log "  ✗ $inst: redsocks port $rport dinlemiyor (uygulama tutmadı)"
  return 1
}

# ★REACH_MARK_20260729: GERÇEK erişim kontrolü.
#
# NEDEN: "çıkış-IP alınabiliyor" sağlık kriteri YANILTICI. Kontrollü testte mi32
# çıkış-IP'sini veriyordu (176.237.217.158) ama WhatsApp'a HİÇ çıkamıyordu — script
# onu "sağlıklı" sayıyordu. Bugünkü olayda da 21 cihaz bu şekilde "38 sağlıklı"
# olarak raporlandı. Operatör için tek anlamlı soru: WhatsApp'a ulaşabiliyor mu?
#
# ⚠️ TEK İSTEK GÜVENİLMEZ: aynı anda ölçülen `https google` 000 iken `https whatsapp`
# 200 çıkabiliyor (canlı gözlem). Bu yüzden 2 deneme + 2 farklı hedef kullanılır;
# HERHANGİ biri tutarsa cihaz sağlıklıdır (yanlış-pozitif "arıza" üretmeyelim —
# gereksiz proxy yeniden-uygulaması ban riski taşır).
wa_reachable() { # addr
  local addr="$1" c
  for _t in 1 2; do
    c=$(timeout 22 "$ADB" -s "$addr" shell 'su -c "curl -s -o /dev/null -w %{http_code} --max-time 12 https://web.whatsapp.com"' </dev/null 2>/dev/null | tr -d '\r\n ')
    [ "$c" = "200" ] && return 0
    c=$(timeout 20 "$ADB" -s "$addr" shell 'su -c "curl -s -o /dev/null -w %{http_code} --max-time 10 https://www.google.com"' </dev/null 2>/dev/null | tr -d '\r\n ')
    [ "$c" = "200" ] && return 0
    sleep 1
  done
  return 1
}

# Cihaz gerçekten çıkabiliyor mu? (Android İÇİNDEN, app-UID → redsocks)
device_exits() { # addr
  local addr="$1" ip
  ip=$(timeout 18 "$ADB" -s "$addr" shell 'curl -s --max-time 14 http://api.ipify.org' </dev/null 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  [ -n "$ip" ] && { echo "$ip"; return 0; }
  return 1
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
#
# ★★★2026-08-13 ".112 VARSAYIMI" SAĞLAM CİHAZLARI "ZOMBIE" SANIP YENİDEN BAŞLATIYORDU.
# Burası adresi "192.168.<subnet>.112:5555" diye ÜRETİYORDU. DHCP başka bir adres
# verdiğinde (canlı ölçüm: 112 cihaz .112, ama 23 cihaz DEĞİL) betik ADB'ye HİÇ
# ulaşamıyor, "reconnect başarısız + host süreci ayakta" görüp ZOMBIE ilan ediyor ve
# cihazı YENİDEN BAŞLATIYOR. 6 tur sonra da DEGRADED işaretleyip durduruyordu —
# operatörün gördüğü "cihazlar kendi kendine duruyor" + DEVICE_DEGRADED bildirimleri.
#
# A/B KANIT (canlı, aynı instance, yan yana):
#   mi270  betik→192.168.172.112:5555 = "error: device not found"
#          GERÇEK →192.168.172.211:5555 = "device"   ← cihaz SAĞLAMDI
#
# FIX: adresi container'ın kendi eth0'ından OKU. Subnet map yalnızca yedek (o da artık
# son okteti varsaymak yerine lease'ten gelen gerçek IP'yi arar).
# ★Aynı ders 30 Tem (mi46) ve 12 Ağu (mi244=.53) yazılmıştı — "IP'yi isimden ÇIKARMA".
adb_addr_for() {
  local inst="$1" sn ip
  # 1) GERÇEK IP — container'ın eth0'ı (tek doğru kaynak)
  ip=$(lxc-attach -n waydroid -P "/var/lib/waydroid.$inst/lxc" -- /system/bin/ip -4 addr show eth0 2>/dev/null \
       | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
  if echo "$ip" | grep -qE '^192\.168\.[0-9]+\.[0-9]+$'; then echo "$ip:5555"; return; fi
  # 2) Yedek: DHCP lease dosyasından (container'a girmeden)
  sn=$(grep -w "$inst" /var/lib/waydroid-subnets.map 2>/dev/null | awk '{print $2}')
  [ -z "$sn" ] && { echo ""; return; }
  ip=$(grep -h "192\.168\.$sn\." "/var/lib/misc/waydroid-$inst.leases" 2>/dev/null | awk '{print $3}' | head -1)
  if echo "$ip" | grep -qE '^192\.168\.[0-9]+\.[0-9]+$'; then echo "$ip:5555"; return; fi
  # 3) Son çare: eski varsayım (hiçbir kaynak cevap vermediyse)
  echo "192.168.$sn.112:5555"
}

OK=0; LEAK=0; RECONN=0; UNREACH=0
DEADEXIT=0; ROTFIX=0; ACCTFIX=0
DEAD_LIST=""
declare -A DONE
# ★2026-08-14: TUR BASI heartbeat. Eskiden yalnizca tur SONUNDA gonderiliyordu;
# uzun turlarda (zombie restart'lari 40+ dk surebiliyor) API izleyiciyi OLMUS
# sanip alarm yagmuru uretiyordu. Olmus betik yine hic ping gonderemez -> 
# dead-man's-switch mantigi bozulmadi.
notify HEALTH_WATCH_HEARTBEAT "" "health-watch turu BASLADI" true

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
  # Tek ADB yoklaması — sonucu hem sağlık kontrolü hem sayaç sıfırlama için kullan
  # (ikinci bir `adb shell` çağrısı 100 cihaz × her tur = gereksiz yük).
  if timeout 12 "$ADB" -s "$addr" shell 'echo ok' </dev/null 2>/dev/null | grep -q ok; then
    _adb_up=1
    rm -f "/var/lib/wd-health/zfail-$inst" 2>/dev/null || true   # sağlıklı → sayacı temizle
  else
    _adb_up=0
  fi
  if [ "$_adb_up" = "0" ]; then
    "$ADB" disconnect "$addr" >/dev/null 2>&1 || true
    "$ADB" connect "$addr" >/dev/null 2>&1 || true
    sleep 2
    if timeout 12 "$ADB" -s "$addr" shell 'echo ok' </dev/null 2>/dev/null | grep -q ok; then
      log "🔄 $inst: erişilemiyordu → adb reconnect BAŞARILI"
      notify AUTO_RECONNECT "$inst" "Cihaz ADB'den erişilemiyordu, otomatik yeniden baglandi" true
      RECONN=$((RECONN+1))
      # ★Cihaz geri geldi → zombie-restart sayacını sıfırla (aşağıdaki DEGRADED
      # kilidini kalıcı hâle getirmemek için ŞART).
      rm -f "/var/lib/wd-health/zfail-$inst" 2>/dev/null || true
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

        # ★2026-08-05 ARDIŞIK-BAŞARISIZLIK LİMİTİ (mi46: 228 restart / 258 ZOMBIE).
        # Zombie-restart, ALTTAKİ arıza restart'la düzelebilir cinstense işe yarar.
        # Kalıcı bir arızada (mi46'da: ülkeye uymayan proxy havuzu) restart hiçbir
        # şeyi düzeltmez ve script SONSUZA KADAR dener: cihaz online/offline flap
        # eder, panelde gürültü olur, log tek cihazla şişer (1.1 MB) ve GERÇEKTEN
        # kurtarılabilir arızalar bu gürültünün içinde kaybolur.
        # Artık N ardışık başarısız restart'tan sonra pes edip cihazı DEGRADED
        # işaretliyoruz: TEK bildirim gider, restart durur, operatör bakar.
        # Sayaç, cihaz ADB'ye geri döndüğünde sıfırlanır (aşağıda, başarı yolunda).
        ZFAIL_MAX="${WD_ZOMBIE_FAIL_MAX:-6}"
        ZF_DIR=/var/lib/wd-health; mkdir -p "$ZF_DIR" 2>/dev/null
        ZF_FILE="$ZF_DIR/zfail-$inst"
        _zf=$(cat "$ZF_FILE" 2>/dev/null || echo 0)
        case "$_zf" in ''|*[!0-9]*) _zf=0 ;; esac
        if [ "$_zf" -ge "$ZFAIL_MAX" ]; then
          # Zaten pes edilmiş. Gürültü yapmadan geç; bildirim yalnızca EŞİĞE
          # ULAŞILDIĞI turda bir kez gitti.
          log "🛑 $inst: $_zf ardışık başarısız zombie-restart → DEGRADED, restart DURDURULDU (elle bakım gerekiyor)"
          continue
        fi
        _zf=$((_zf+1)); echo "$_zf" > "$ZF_FILE" 2>/dev/null
        if [ "$_zf" -ge "$ZFAIL_MAX" ]; then
          log "🛑 $inst: $_zf. başarısız zombie-restart → DEGRADED işaretlendi, bundan sonra restart YOK"
          notify DEVICE_DEGRADED "$inst" "$_zf ardisik zombie-restart sonuc vermedi; otomatik restart durduruldu, elle bakim gerekiyor" false
        fi

        log "🧟 $inst: ADB reconnect başarısız + host-süreç ayakta = ZOMBIE → runtime temizlenip yeniden başlatılıyor (deneme $_zf/$ZFAIL_MAX)"
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
  # 2026-07-30: OZEL/YEREL adresi GECERLI SAYMA. api.ipify.org bazi thordata cikis
  # dugumlerinde cihazin gercek cikisi yerine bir OZEL adres donduruyor (CANLI:
  # mi30 -> 192.168.5.118, ayni anda ifconfig.me + icanhazip 81.214.62.105 diyordu).
  # Eski kod ilk DOLU yaniti kabul ediyordu -> ozel adres "cikis IP" sanilir; bu ya
  # yanlis "sizinti" alarmi ya da yanlis "ulke uyumsuz" karari uretir. Artik ozel
  # araliklar (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16) REDDEDILIR ve sonraki
  # saglayiciya gecilir.
  is_public_ip() { # ip -> 0 (public) / 1 (ozel/gecersiz)
    case "$1" in
      ""|10.*|127.*|169.254.*|192.168.*) return 1 ;;
      172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) return 1 ;;
      *) return 0 ;;
    esac
  }
  exit_ip=""
  for _svc in "http://api.ipify.org" "http://ifconfig.me/ip" "http://icanhazip.com"; do
    for _try in 1 2; do
      _cand="$(timeout 18 "$ADB" -s "$addr" shell "curl -s --max-time 14 $_svc" </dev/null 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
      if is_public_ip "$_cand"; then exit_ip="$_cand"; break; fi
      [ -n "$_cand" ] && log "  ? $inst: $_svc OZEL adres dondurdu ($_cand) - yoksayildi"
    done
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
      # ★ÇIKIŞ-ÖLÜ: redsocks ayakta + ağ canlı ama çıkış yok → upstream/ülke havuzu
      # sorunu. Eskiden burada sadece "geçici olabilir" yazılıp geçiliyordu.
      if [ -z "$cc" ]; then
        log "? $inst: çıkış-IP alınamadı, ülke bilinmiyor → düzeltilemiyor"
      else
        DEADEXIT=$((DEADEXIT+1)); DEAD_LIST="$DEAD_LIST $inst"
        if is_mobile_cc "$cc"; then CU="$U_MOB"; CP="$P_MOB"; CPORT="$PORT_MOB"; AU="$U_RES"; AP="$P_RES"; APORT="$PORT_RES"
        else                        CU="$U_RES"; CP="$P_RES"; CPORT="$PORT_RES"; AU="$U_MOB"; AP="$P_MOB"; APORT="$PORT_MOB"; fi
        _rec=0

        # ★2026-08-05 ADIM 0 — ÜLKE↔PORT HİZALAMA (mi46'nın 228 restart'ının kökü).
        # Cihazın config'i ülkesine UYMAYAN porta bağlıysa hiçbir rotasyon işe yaramaz:
        # o havuzda o ülke YOK. Kurtarma denemeden önce doğru porta çekiyoruz.
        _curport=$(inst_upstream_port "$inst")
        if [ -n "$_curport" ] && ! cc_port_ok "$cc" "$_curport"; then
          log "⚑ $inst: ÜLKE↔PORT UYUMSUZ ($cc ama port=$_curport) → doğru havuza ($CPORT) alınıyor"
          _sid0="$(echo "$inst$cc" | tr -cd 'A-Za-z0-9')p$(date +%H%M)"
          if upstream_ok "$CU" "$CP" "$CPORT" "$cc" "$_sid0" \
             && apply_with_sessid "$inst" "$cc" "$CU" "$CP" "$CPORT" "$_sid0"; then
            sleep 2
            if _ip=$(device_exits "$addr"); then
              log "  ✓ $inst: port hizalamasıyla kurtarıldı (çıkış=$_ip, port=$CPORT)"
              ACCTFIX=$((ACCTFIX+1)); _rec=1
              notify PROXY_PORT_REALIGNED "$inst" "$cc yanlis havuzdaydi (port $_curport), $CPORT'a alindi (cikis=$_ip)" true
            fi
          fi
        fi

        # ADIM 1: sessid rotasyonu (aynı hesap, yeni oturum).
        if [ "$_rec" = "0" ]; then
        _sid="$(echo "$inst$cc" | tr -cd 'A-Za-z0-9')r$(date +%H%M)"
        if upstream_ok "$CU" "$CP" "$CPORT" "$cc" "$_sid"; then
          log "↻ $inst: çıkış ölü → sessid döndürülüyor ($cc, $_sid)"
          if apply_with_sessid "$inst" "$cc" "$CU" "$CP" "$CPORT" "$_sid"; then
            sleep 2
            if _ip=$(device_exits "$addr"); then
              log "  ✓ $inst: sessid rotasyonu ile kurtarıldı (çıkış=$_ip)"
              ROTFIX=$((ROTFIX+1)); _rec=1
            fi
          fi
        else
          log "  ⚠ $inst: mevcut hesabın $cc havuzu upstream'de de ÖLÜ (502)"
        fi
        fi
        # ADIM 2: hesap değiştir — o ülkeyi VEREN diğer hesap var mı?
        # ★2026-08-05 `cc_port_ok` GUARD'I: eskiden bu adım ülkeyi diğer hesabın
        # portuna taşıyordu. TR için bu residential(5555) demek = kalıcı ölü havuz.
        # Canlıda tam bunu yapıyordu: "diğer hesap TR veriyor → port 5555" yazıp
        # config'i BOZUYOR, sonra kurtaramayıp bozuk hâlde BIRAKIYORDU (geri alma yok).
        # Artık yalnızca ülkeye UYAN porta geçiş denenir.
        if [ "$_rec" = "0" ] && [ -n "$AU" ] && [ "$AU" != "$CU" ] && cc_port_ok "$cc" "$APORT"; then
          _sid2="$(echo "$inst$cc" | tr -cd 'A-Za-z0-9')a$(date +%H%M)"
          if upstream_ok "$AU" "$AP" "$APORT" "$cc" "$_sid2"; then
            log "⇄ $inst: diğer hesap $cc veriyor → hesap değiştiriliyor (port $APORT)"
            if apply_with_sessid "$inst" "$cc" "$AU" "$AP" "$APORT" "$_sid2"; then
              sleep 2
              if _ip=$(device_exits "$addr"); then
                log "  ✓ $inst: hesap değiştirilerek kurtarıldı (çıkış=$_ip)"
                ACCTFIX=$((ACCTFIX+1)); _rec=1
                notify PROXY_ACCOUNT_SWITCH "$inst" "$cc havuzu olu idi, diger hesaba alindi (cikis=$_ip)" true
              fi
            fi
          fi
        fi
        [ "$_rec" = "0" ] && log "  ✗ $inst: çıkış kurtarılamadı ($cc) — filo özeti sonda"
      fi
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
    # ★REACH_MARK_20260729: çıkış-IP geldi diye "sağlıklı" DEME — gerçekten erişebiliyor mu?
    # (mi32 canlı kanıt: IP veriyordu, WhatsApp'a çıkamıyordu.)
    if wa_reachable "$addr"; then
      OK=$((OK+1))
    else
      DEADEXIT=$((DEADEXIT+1)); DEAD_LIST="$DEAD_LIST $inst"
      log "⚠ $inst: çıkış-IP var ($exit_ip) ama ERİŞİM YOK → kurtarma deneniyor (cc=${cc:-?})"
      if [ -z "$cc" ]; then
        log "  ✗ $inst: ülke bilinmiyor, düzeltilemiyor"
      else
        if is_mobile_cc "$cc"; then CU="$U_MOB"; CP="$P_MOB"; CPORT="$PORT_MOB"; AU="$U_RES"; AP="$P_RES"; APORT="$PORT_RES"
        else                        CU="$U_RES"; CP="$P_RES"; CPORT="$PORT_RES"; AU="$U_MOB"; AP="$P_MOB"; APORT="$PORT_MOB"; fi
        _rec=0
        _sid="$(echo "$inst$cc" | tr -cd 'A-Za-z0-9')x$(date +%H%M)"
        if upstream_ok "$CU" "$CP" "$CPORT" "$cc" "$_sid" && apply_with_sessid "$inst" "$cc" "$CU" "$CP" "$CPORT" "$_sid"; then
          sleep 2
          if wa_reachable "$addr"; then log "  ✓ $inst: sessid rotasyonu ile erişim geri geldi"; ROTFIX=$((ROTFIX+1)); _rec=1; fi
        fi
        if [ "$_rec" = "0" ] && [ -n "$AU" ] && [ "$AU" != "$CU" ]; then
          _sid2="$(echo "$inst$cc" | tr -cd 'A-Za-z0-9')y$(date +%H%M)"
          if upstream_ok "$AU" "$AP" "$APORT" "$cc" "$_sid2" && apply_with_sessid "$inst" "$cc" "$AU" "$AP" "$APORT" "$_sid2"; then
            sleep 2
            if wa_reachable "$addr"; then
              log "  ✓ $inst: hesap değiştirilerek erişim geri geldi"
              ACCTFIX=$((ACCTFIX+1)); _rec=1
              notify PROXY_ACCOUNT_SWITCH "$inst" "$cc erisimi yoktu, diger hesaba alindi" true
            fi
          fi
        fi
        [ "$_rec" = "0" ] && log "  ✗ $inst: erişim kurtarılamadı ($cc)"
      fi
    fi
  fi
done <<< "$ROWS"

log "TAMAM: $OK sağlıklı, $LEAK sızıntı-düzeltildi, $RECONN reconnect, $UNREACH erişilemez, $DEADEXIT çıkış-ölü (rot=$ROTFIX, hesap=$ACCTFIX)"

# ★FİLO EŞİĞİ: tek cihazın geçici takılması sessizce düzeltilir (yukarıda loglandı).
# Kurtarılamayan cihaz sayısı eşiği aşarsa = SİSTEMİK arıza (ülke havuzu ölü gibi) →
# cihaz başına değil, TEK özet alarm. Bugünkü olayda 21 cihaz düşmüştü ve hiç alarm
# gitmemişti; eşik bunu tam olarak yakalar.
_unrec=$(( DEADEXIT - ROTFIX - ACCTFIX ))
FLEET_ALERT_MIN="${WD_DEADEXIT_ALERT_MIN:-3}"
if [ "$_unrec" -ge "$FLEET_ALERT_MIN" ]; then
  log "🚨 FİLO UYARISI: $_unrec cihaz çıkış yapamıyor (kurtarılamadı) →$DEAD_LIST"
  notify PROXY_POOL_DOWN "" "$_unrec cihaz cikis yapamiyor (kurtarilamadi). Ulke havuzu olu olabilir. Instance: $(echo $DEAD_LIST | cut -c1-160)" false
fi
# ★2026-07-23 (M-3): dead-man's-switch heartbeat. Report "I ran" so the API can detect if
# this monitor ever stops (env/DB failure → silent exit). The API stamps Host.lastHealthWatchAt
# and alerts if it goes >20min stale. Best-effort; never blocks the run.
notify HEALTH_WATCH_HEARTBEAT "" "health-watch turu tamamlandi ($OK saglikli, $LEAK sizinti, $RECONN reconnect)" true
exit 0
