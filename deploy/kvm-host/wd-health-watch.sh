#!/usr/bin/env bash

# ★★★2026-08-17 TEK-ORNEK KILIDI — CAKISAN TURLAR CIHAZ DUSURUYORDU.
# Timer 7 dk'da bir tetikler ama bir tur (zombie-restart'larla) 85 dk surebiliyor
# -> turlar UST USTE biniyordu. CANLI KANIT: ayni anda pid=534571 (31 dk) ve
# pid=2102361 (0 dk). Iki tur ayni cihazda yarisinca: A restart eder (Android boot
# ediyor, ADB yok) -> B "ZOMBIE" ilan edip TEKRAR baslatir -> cihaz boot'u hic
# bitiremez, sonsuz churn. Panelde "cihazlar kendiliginden dusuyor" bu.
# Kilit alinamazsa sessizce cik; bir sonraki timer turunda nasil olsa denenir.
_hw_lock() {
  exec 9>/run/wd-health-watch.lock
  flock -n 9
}
if ! _hw_lock; then
  # ★★★2026-08-18 OLU KILIT KORUMASI. Kilit alinamamasi HER ZAMAN "zaten calisiyor"
  # demek DEGIL: FD 9'u miras alan uzun omurlu cocukler (redsocks/dbus/adb alt
  # surecleri) ana surec oldukten sonra da kilidi tutabiliyor.
  # CANLI: 40+ dk boyunca HIC tur calismadi (surec sayisi 0 iken her tur "atlandi"),
  # panel "Saglik izleyici durdu" alarmi verdi ve otonom kurtarma tamamen durdu.
  # Bu yuzden kilide DEGIL, GERCEGE bakiyoruz: baska bir tur gercekten yasiyor mu?
  # ★★★2026-08-18 KENDI ALT KABUGUMUZU "baska tur" SANIYORDUK.
  # `$( )` komut ikamesi betigin bir KOPYASINI fork'lar; komut satiri ayni oldugu icin
  # `pgrep -f` onu BULUR, ama pid'i `$$`'tan farklidir -> eleme tutmaz -> koruma HIC
  # calismaz. CANLI: 55 dk boyunca her tur "onceki tur HALA calisiyor (pid=...)" dedi,
  # pid her seferinde DEGISIYORDU ve gercekte HICBIR tur yoktu (surec sayisi 0).
  # Cozum: pid'i YASINA gore ele — kendi fork'umuz 0-1 sn'lik, gercek bir onceki tur
  # en az bir timer araligi (7 dk) once baslamistir. 20 sn esigi ikisini kesin ayirir.
  _hw_other_turn() {
    local p age
    for p in $(pgrep -f 'wd-health-watch\.sh' 2>/dev/null); do
      [ "$p" = "$$" ] && continue
      [ "$p" = "$BASHPID" ] && continue
      age=$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')
      case "$age" in ''|*[!0-9]*) continue ;; esac
      [ "$age" -ge 20 ] && { echo "$p"; return 0; }
    done
    return 1
  }
  _alive=$(_hw_other_turn)
  if [ -n "$_alive" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') ⏭ onceki tur HALA calisiyor (pid=$_alive) — bu tur atlandi" \
      >> /var/log/wd-health-watch.log 2>/dev/null
    exit 0
  fi
  # Calisan tur YOK -> kilit OLU. Temizle ve DEVAM ET (yoksa kurtarma sonsuza kadar durur).
  echo "$(date '+%Y-%m-%d %H:%M:%S') ♻ OLU KILIT temizlendi (calisan tur yok) — devam ediliyor" \
    >> /var/log/wd-health-watch.log 2>/dev/null
  rm -f /run/wd-health-watch.lock 2>/dev/null
  _hw_lock || true
fi

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

# ★★★2026-08-17 KURTARMA SURESI OLCUMU (/durum sayfasinda canli gosterilir).
# Amac: "dusen cihaz ben mudahale etmeden kac dk'da kalkiyor?" sorusunu OLCMEK.
# Maliyet ~sifir: cihaz basina tek kucuk dosya yaz/oku (/proc TARAMASI YOK).
WD_STATE_DIR=/var/lib/wd-health
mkdir -p "$WD_STATE_DIR" 2>/dev/null || true
RECLOG="$WD_STATE_DIR/recovery.log"

# Cihaz dustu: ILK dusus anini kaydet (zaten varsa DOKUNMA - sure baştan sayilmali).
mark_down() {
  local _i="$1"
  [ -f "$WD_STATE_DIR/down-$_i" ] || date +%s > "$WD_STATE_DIR/down-$_i" 2>/dev/null
}

# Cihaz geri geldi: sureyi hesapla, kalici loga yaz, dusus damgasini temizle.
# $2 = kurtarma yontemi (reconnect | zombie-restart | kendiliginden)
mark_up() {
  local _i="$1" _how="${2:-kendiliginden}" _t0 _now _dur
  _t0=$(cat "$WD_STATE_DIR/down-$_i" 2>/dev/null)
  case "$_t0" in ''|*[!0-9]*) rm -f "$WD_STATE_DIR/down-$_i" 2>/dev/null; return ;; esac
  _now=$(date +%s); _dur=$((_now - _t0))
  [ "$_dur" -lt 0 ] && _dur=0
  echo "$_now $_i $_dur $_how" >> "$RECLOG" 2>/dev/null
  # log sisme freni: 5000 satiri gecerse son 2000'i tut
  if [ "$(wc -l < "$RECLOG" 2>/dev/null || echo 0)" -gt 5000 ]; then
    tail -2000 "$RECLOG" > "$RECLOG.tmp" 2>/dev/null && mv "$RECLOG.tmp" "$RECLOG" 2>/dev/null
  fi
  rm -f "$WD_STATE_DIR/down-$_i" 2>/dev/null
  log "  ⏱ $_i: ${_dur}sn sonra geri geldi ($_how)"
}
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

# ★★★2026-08-20 HMAC IMZASI + JSON KACISI.
#
# ONCE: bu fonksiyon `detail`i HIC kacislamadan JSON'a gomuyordu. Icinde bir cift
# tirnak veya satir sonu olan her uyari BOZUK JSON uretiyordu (sessizce dusuyordu).
#
# AYRICA imzasizdi: API her ~9 dk "[agent-sign] unsigned request ... allowed" yaziyordu.
# Yani yalnizca api-key'e sahip biri SAHTE cihaz/saglik raporu gonderebilirdi
# (cihazi "dustu" gostermek, sahte alarm urettirmek, gozcu kararlarini yonlendirmek).
#
# Sunucu tarafi (apps/api/src/modules/agent/agent.signature.ts:89):
#     canonical = ${ts}.${METHOD}.${req.originalUrl}.${JSON.stringify(req.body)}
#     HMAC-SHA256, anahtar = DUZ METIN agent key (x-agent-key), +-5 dk kayma toleransi
# ⚠️Govde sunucuda YENIDEN serilestiriliyor (ham bayt degil) — bizim urettigimiz JSON
#   Node'un JSON.stringify ciktisiyla BAYT BAYT ayni olmali: bosluksuz, ayni anahtar sirasi.
#
# KACIS STRATEJISI (bilerek muhafazakar): once TUM kontrol karakterleri temizlenir
# (tab/LF/CR -> bosluk, digerleri silinir), sonra yalniz \ ve " kacislanir. Boylece
# Node'un \u00XX / \n kisa-form kacislarini taklit etmeye calismak GEREKMEZ; gidis-donus
# birebir ayni kalir. Detail insan metni oldugu icin kayip onemsiz.
# ★★★2026-08-20 HMAC IMZASI + JSON GOVDESI (v2).
#
# ONCE: `detail` HIC kacislanmadan JSON'a gomuluyordu — icinde bir cift tirnak veya
# satir sonu olan her uyari BOZUK JSON uretiyordu (sessizce dusuyordu). Istek ayrica
# IMZASIZDI: API her ~9 dk "[agent-sign] unsigned request ... allowed" yaziyordu, yani
# yalnizca api-key'e sahip biri SAHTE cihaz/saglik raporu gonderebiliyordu.
#
# Sunucu kanonik dizesi (apps/api/src/modules/agent/agent.signature.ts:89):
#     ${ts}.${METHOD}.${req.originalUrl}.${JSON.stringify(req.body)}
#     HMAC-SHA256, anahtar = DUZ METIN agent key (x-agent-key), +-5 dk kayma toleransi
#
# ★★★NEDEN GOVDEYI NODE URETIYOR: sunucu govdeyi PARSE EDIP JSON.stringify ile
# YENIDEN serilestiriyor. HMAC'in tutmasi icin bizim urettigimiz baytlar Node'un
# uretecegiyle BIREBIR ayni olmali. Elle sed/bash kacisi yazmak bunu garanti etmez
# (ve bu ortamda ters bolu kacislari yazarken bozulabiliyor — v1 tam bundan patladi:
#  's/\/\\/g' diye yazilan ifade diske 's/\/\/g' olarak dustu ve sed "unterminated
#  s command" verdi; `bash -n` bunu YAKALAMAZ cunku gecerli bash dizesi).
# Node'a urettirmek hem kacis sorununu hem gidis-donus esitligini KOKTEN cozer.
NODE_BIN="${NODE_BIN:-/usr/bin/node}"
build_alert_body() { # kind instance detail fixed(true|false)
  "$NODE_BIN" -e 'const a=process.argv.slice(1);process.stdout.write(JSON.stringify({kind:a[0],instance:a[1],detail:a[2],fixed:a[3]==="true"}))' "$1" "$2" "$3" "$4" 2>/dev/null
}

# API'ye sağlık uyarısı gönder (best-effort, script'i asla bloklamaz).
notify() { # kind instance detail fixed
  [ -z "$API_KEY" ] && return 0
  local body ts sign path fixed
  fixed="${4:-false}"
  case "$fixed" in true|false) ;; *) fixed=false ;; esac
  path="/agent/health-alert"
  body=$(build_alert_body "$1" "$2" "$3" "$fixed")
  [ -z "$body" ] && return 0          # node yoksa/patlarsa sessizce vazgec
  ts=$(date +%s%3N)
  sign=$(printf '%s' "${ts}.POST.${path}.${body}" \
         | openssl dgst -sha256 -hmac "$HOST_KEY" -r 2>/dev/null | cut -d' ' -f1)
  timeout 10 curl -s -o /dev/null -X POST "$API_URL$path" \
    -H "x-api-key: $API_KEY" -H "x-agent-key: $HOST_KEY" \
    -H "x-agent-ts: $ts" -H "x-agent-sign: $sign" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>/dev/null || true
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

# ★★★2026-08-20 MEZAR TASI SUPURGESI. Cihaz silinince /var/lib/wd-health/ altindaki
# durum damgalari GERIDE KALIYORDU ve /durum sayfasi onlari "su an dusuk cihaz"
# sayiyordu. Canli vaka: sayfa "su an dusuk: 15" diyordu — 15'inin de HEPSI coktan
# SILINMISTI (hicbiri DB'de/enabled degildi, 9'unun dizini bile yoktu, damgalar
# 40-67 saatlikti). Filo 141/141 TAM AYAKTAYKEN operator 15 cihazi dusuk goruyordu.
# wd-destroy.sh artik silme aninda temizliyor; bu supurge ONCEDEN silinmislerin
# artigini ve wd-destroy'u atlayan her yolu kapatir.
# GUVENLIK: yalnizca ROWS (DB'deki GERCEK cihaz listesi) DOLU iken calisir --
# DB bir an cevap vermezse tum damgalari silip kurtarma surelerini kaybetmeyelim.
_FLEET_INSTS=$(echo "$ROWS" | cut -d'|' -f1 | grep -v '^$' | sort -u)
if [ -n "$_FLEET_INSTS" ]; then
  _purged=0
  for _sf in /var/lib/wd-health/down-* /var/lib/wd-health/zfail-* /var/lib/wd-health/bootstuck-*; do
    [ -e "$_sf" ] || continue
    _si=$(basename "$_sf"); _si=${_si#down-}; _si=${_si#zfail-}; _si=${_si#bootstuck-}
    printf '%s\n' "$_FLEET_INSTS" | grep -qxF "$_si" && continue
    rm -f "$_sf" 2>/dev/null && _purged=$((_purged+1))
  done
  [ "$_purged" -gt 0 ] && log "🧹 silinmis cihazlardan kalan $_purged saglik damgasi temizlendi"
fi

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
  # ★★★2026-08-17 YOL DUZELTILDI: gercek dosya "dnsmasq." onekli.
  # Eski yol (/var/lib/misc/waydroid-<inst>.leases) HIC yoktu -> bu adim daima
  # bos donuyor, adres ".112" fallback'ine dusuyordu -> yanlis adrese baglanip
  # saglam cihaz ZOMBIE sanilip sonsuza kadar yeniden baslatiliyordu.
  # Tohum satirini (sabit MAC 00:16:3e:f9:d3:03 = eski .112 tohumu) ELE; en TAZE
  # gercek kiralamayi al (son satir).
  ip=$(cat "/var/lib/misc/dnsmasq.waydroid-$inst.leases" "/var/lib/misc/waydroid-$inst.leases" 2>/dev/null \
       | awk '$2 != "00:16:3e:f9:d3:03" && $3 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print $3}' | tail -1)
  if echo "$ip" | grep -qE '^192\.168\.[0-9]+\.[0-9]+$'; then echo "$ip:5555"; return; fi
  # 3) Son çare: eski varsayım (hiçbir kaynak cevap vermediyse)
  echo "192.168.$sn.112:5555"
}

OK=0; LEAK=0; RECONN=0; UNREACH=0
DEADEXIT=0; ROTFIX=0; ACCTFIX=0; BOOTFIX=0
DEAD_LIST=""
declare -A DONE
# ★2026-08-14: TUR BASI heartbeat. Eskiden yalnizca tur SONUNDA gonderiliyordu;
# uzun turlarda (zombie restart'lari 40+ dk surebiliyor) API izleyiciyi OLMUS
# sanip alarm yagmuru uretiyordu. Olmus betik yine hic ping gonderemez -> 
# dead-man's-switch mantigi bozulmadi.
notify HEALTH_WATCH_HEARTBEAT "" "health-watch turu BASLADI" true


# ★★★2026-08-19 TUR BASINA TEK SUREC TARAMASI (eskiden ~400 tam /proc taramasi).
# `pgrep -f` her cagride TUM /proc'u gezer: bu makinede 14.198 surec, olcum ~1335 ms.
# Tur basina 140 instance x 2-3 cagri = ~530 sn CPU -> 7 dakikada bir pgrep %217.
# Simdi TEK `ps` ile indekslenir; sorgular O(1). Olcum: 1149 ms, 140+140 surec.
# ★Onek cakismasi YAPISAL olarak imkansiz: anahtar TAM instance adi (mi30 != mi300).
declare -A WD_RUN_PID LXC_PID
_wd_scan_procs() {
  WD_RUN_PID=(); LXC_PID=()
  local pid args inst
  while read -r pid args; do
    case "$args" in
      *"wd-run.sh mi"*)
        inst=${args#*wd-run.sh }; inst=${inst%% *}
        case "$inst" in mi[0-9]*) [ -z "${WD_RUN_PID[$inst]:-}" ] && WD_RUN_PID[$inst]=$pid ;; esac ;;
      *"waydroid.mi"*"/lxc"*)
        inst=${args#*waydroid.}; inst=${inst%%/lxc*}
        case "$inst" in mi[0-9]*) [ -z "${LXC_PID[$inst]:-}" ] && LXC_PID[$inst]=$pid ;; esac ;;
    esac
  done < <(ps -eo pid=,args= 2>/dev/null)
}
_wd_scan_procs
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
    mark_up "$inst" kendiliginden   # ★dusukse sureyi kaydet (degilse no-op)
    # ★★★2026-09-03 "FRAMEWORK OLU" TESPITI — ADB + boot_completed YETMIYOR.
    # CANLI: mi180/mi187/mi189 saatlerce "saglikli" gorundu (adb ok, boot_completed=1)
    # ama system_server OLMUSTU (`cmd: Can't find service: package/activity`): WhatsApp
    # acilamiyor, canli-tutma 82x "ACILAMADI" yaziyor, hicbir gozcu restart etmiyordu.
    # SINYAL: boot_completed=1 (framework bir kez acilmis) AMA pidof system_server BOS
    # (sonradan olmus). Tek adb shell (~60 ms). Watchdog'un normal system_server
    # yeniden baslatmasini (saniyeler) yanlis pozitif yapmamak icin 2 ARDISIK tur sart.
    _fw=$(timeout 12 "$ADB" -s "$addr" shell 'getprop sys.boot_completed; pidof system_server' </dev/null 2>/dev/null | tr -d '\r' | tr '\n' ' ')
    case "$_fw" in
      1\ [0-9]*) rm -f "/var/lib/wd-health/fwdead-$inst" 2>/dev/null || true ;;   # boot=1 + system_server var → saglikli
      1\ *|1)
        mkdir -p /var/lib/wd-health 2>/dev/null
        _fd=$(cat "/var/lib/wd-health/fwdead-$inst" 2>/dev/null || echo 0); case "$_fd" in ''|*[!0-9]*) _fd=0 ;; esac
        _fd=$((_fd+1)); echo "$_fd" > "/var/lib/wd-health/fwdead-$inst" 2>/dev/null
        if [ "$_fd" -lt 2 ]; then
          log "⚠ $inst: boot_completed=1 ama system_server YOK (1. gorus) — bir tur daha bekleniyor"
        else
          _dstate=$(awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0); case "$_dstate" in ''|*[!0-9]*) _dstate=0 ;; esac
          if [ "$_dstate" -ge "${WD_DSTATE_MAX:-50}" ]; then
            log "⏸ $inst: framework olu ama host tikali (D-state=$_dstate) → restart ERTELENDİ"
          else
            log "🧟 $inst: FRAMEWORK OLU (adb ok, boot=1, system_server YOK, $_fd tur) → runtime temizlenip yeniden başlatılıyor"
            rm -f "/var/lib/wd-health/fwdead-$inst" 2>/dev/null || true
            pkill -9 -f "wd-run.sh $inst\$" 2>/dev/null || true
            pkill -9 -f "wayland-$inst($|[^0-9])" 2>/dev/null || true
            pkill -9 -f "xdg-$inst($|[^0-9])" 2>/dev/null || true
            pkill -9 -f "waydroid.*--instance $inst($|[^0-9])" 2>/dev/null || true
            pkill -9 -f "lxc-start.*waydroid\.$inst($|[^0-9])" 2>/dev/null || true
            pkill -9 -f "dnsmasq.*waydroid-$inst($|[^0-9])" 2>/dev/null || true
            timeout 20 lxc-stop -n waydroid -P "/var/lib/waydroid.$inst/lxc" -k 2>/dev/null || true
            rm -rf "/run/xdg-$inst" "/run/wd-$inst" "/run/waydroid-$inst-lxc" 2>/dev/null || true
            sleep 3
            setsid bash "$WD_RUN" "$inst" >/dev/null 2>&1 < /dev/null 9>&- &
            notify AUTO_RECONNECT "$inst" "Android framework (system_server) olmustu, adb saglikli gorunuyordu - runtime temizlenip yeniden baslatildi" true
            RECONN=$((RECONN+1))
            continue
          fi
        fi ;;
      *) : ;;   # boot_completed 0/bos → hala aciliyor; bu yol boot-stuck mantiginin isi
    esac
  else
    _adb_up=0
  fi
  if [ "$_adb_up" = "0" ]; then
    mark_down "$inst"   # ★ILK dusus ani (varsa korunur) — kurtarma suresi buradan sayilir
    "$ADB" disconnect "$addr" >/dev/null 2>&1 || true
    "$ADB" connect "$addr" >/dev/null 2>&1 || true
    sleep 2
    if timeout 12 "$ADB" -s "$addr" shell 'echo ok' </dev/null 2>/dev/null | grep -q ok; then
      log "🔄 $inst: erişilemiyordu → adb reconnect BAŞARILI"
      mark_up "$inst" reconnect
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
      # ★★★2026-08-17 ZOMBIE ILAN ETMEDEN ONCE ADB'DEN BAGIMSIZ TEYIT.
      # ADB sunucusu doydugunda (150 cihaz + agent trafigi) 12sn'lik `adb shell echo ok`
      # yoklamasi TIMEOUT'a dusuyor ve SAGLAM cihaz "erisilemez" sayiliyordu -> zombie
      # -> yeniden baslatma -> 2-3 dk boot -> panelde "cihaz dustu" (CANLI KANIT:
      # mi308/mi300/mi185 zombie ilan edildi ama ping OK, port ACIK, boot=1, shell "ok").
      # Bu yuzden once UCUZ ve BAGIMSIZ iki kanit: TCP 5555 acik mi + boot_completed=1 mi.
      _live_ip="${addr%%:*}"
      _tcp_ok=""
      [ -n "$_live_ip" ] && timeout 3 bash -c "echo > /dev/tcp/$_live_ip/5555" 2>/dev/null && _tcp_ok=1
      if [ -n "$_tcp_ok" ]; then
        _bc=$(timeout 8 lxc-attach -n waydroid -P "/var/lib/waydroid.$inst/lxc" -- getprop sys.boot_completed 2>/dev/null | tr -d '\r')
        if [ "$_bc" = "1" ]; then
          # Cihaz CANLI — sorun ADB ucunda. Yeniden baslatma; ucu tazele ve gec.
          log "🔌 $inst: ADB yoklamasi basarisiz AMA cihaz CANLI (port 5555 acik, boot=1) → zombie-restart YOK, uc tazelendi"
          "$ADB" disconnect "$addr" >/dev/null 2>&1 || true
          "$ADB" connect "$addr" >/dev/null 2>&1 || true
          mark_up "$inst" uc-tazeleme
          rm -f "/var/lib/wd-health/zfail-$inst" 2>/dev/null || true
          continue
        fi
      fi
      # ★★★2026-08-19 ONEK ESLESMESI DUZELTILDI — zombie karari KOMSUNUN sureciyle
      # veriliyordu: `pgrep -f "wd-run.sh mi30"` mi300'un surecini de bulur.
      if [ -n "${WD_RUN_PID[$inst]:-}" ] || [ -n "${LXC_PID[$inst]:-}" ]; then
        # ★BOOT-GRACE (2026-07-23): bir instance BOOT ederken (henüz ~90s dolmamış) ADB'den
        # erişilemez — bu ZOMBIE DEĞİL, sadece boot bitmemiş. Onu zombie sanıp yeniden
        # başlatmak, boot eden instance'ın ÜSTÜNE İKİNCİ bir wd-run başlatır → DUPLICATE
        # wd-run → aynı binder/DBus runtime'ında çakışma → İKİSİ DE bozulur (KANITLANDI:
        # 33 wd-run + 14 cihaz düştü). Bu yüzden: wd-run.sh $inst süreci son BOOT_GRACE_S
        # saniye içinde başlamışsa BEKLE, dokunma. mtime ile yaşını ölç (process start).
        # ★★★2026-08-17 GRACE ARTIK SURECE DEGIL BOOT DAMGASINA DAYANIYOR.
        # ESKI KOD "wd-run.sh <inst> sureci yasiyor mu" diye bakiyordu; ama wd-run
        # container'i baslatip CIKIYOR -> wr_pid BOS -> grace blogu TAMAMEN atlaniyor
        # -> BOOT EDEN cihaz "ZOMBIE" ilan edilip yeniden baslatiliyordu -> boot bir
        # daha basliyor -> SONSUZ DONGU (canli: 4 dk izlemede adb 140 -> 133 DUSTU;
        # log'da mi300/mi306/mi308 boot ederken zombie ilan edildi).
        # Artik UC kaynaktan EN TAZESI'ne bakiyoruz; biri bile taze ise DOKUNMA.
        BOOT_GRACE_S="${WD_BOOT_GRACE_S:-300}"
        _now_s=$(date +%s); _boot_age=999999
        # a) wd-run sureci (hala calisiyorsa)
        wr_pid="${WD_RUN_PID[$inst]:-}"
        if [ -n "$wr_pid" ]; then
          _a=$((_now_s - $(stat -c %Y "/proc/$wr_pid" 2>/dev/null || echo 0)))
          [ "$_a" -lt "$_boot_age" ] && _boot_age=$_a
        fi
        # b) BOOT DAMGASI — asil kaynak (wd-run basinda yazar, surece bagli DEGIL)
        if [ -f "/run/wd-boot-$inst" ]; then
          _t0=$(cat "/run/wd-boot-$inst" 2>/dev/null)
          case "$_t0" in ''|*[!0-9]*) _t0="" ;; esac
          if [ -n "$_t0" ]; then _a=$((_now_s - _t0)); [ "$_a" -lt "$_boot_age" ] && _boot_age=$_a; fi
        fi
        # c) lxc-start sureci yasi — damga yoksa yedek
        _lx="${LXC_PID[$inst]:-}"
        if [ -n "$_lx" ]; then
          _a=$((_now_s - $(stat -c %Y "/proc/$_lx" 2>/dev/null || echo 0)))
          [ "$_a" -lt "$_boot_age" ] && _boot_age=$_a
        fi
        if [ "$_boot_age" -lt "$BOOT_GRACE_S" ]; then
          log "⏳ $inst: boot sürüyor (${_boot_age}s < ${BOOT_GRACE_S}s) → zombie-restart ATLANDI, bekleniyor"
          continue
        fi
        # ★★★2026-08-17 LOAD-GATE KALDIRILDI -> D-STATE GATE.
        # ESKI: load >= cores*0.9 (=72) ise zombie-restart ERTELENIYORDU.
        # CANLI KANIT (2026-08-17): "⏸ mi129: ... (load=116 ≥ 72) → ERTELENDİ" satiri
        # dusuldugu ANDA gercek olcumler: D-state=0, CPU %88 BOSTA, 119 GB bos RAM.
        # Sistem BOSTU ama fren basili kaldi -> mi100/mi102/mi105 4+ SAAT olu kaldi,
        # panelde filo 178->121 dustu. Yani "yuk freni"nin KENDISI arizayi kalicilastirdi.
        # NEDEN: Waydroid'de her instance yuzlerce UYUYAN thread tutar ve Linux bunlari
        # load'a sayar (150 cihaz ~ yuz binlerce thread) -> load DAIMA 90-500, CPU bos olsa
        # bile. Panel de bunu yaziyor: "Ham load ... yaniltici". wd-boot-gate.sh'te ayni
        # ders 2026-08-14'te ogrenilip load ORADAN kaldirilmisti; burada atlanmisti.
        # YENI OLCUT: /proc/stat procs_blocked (D-state) — gercek I/O tikanmasi, cekirdek
        # sayaci, tek kucuk dosya okumasi (/proc TARAMASI YOK).
        _dstate=$(awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0)
        case "$_dstate" in ''|*[!0-9]*) _dstate=0 ;; esac
        _dmax="${WD_DSTATE_MAX:-50}"
        if [ "${_dstate:-0}" -ge "${_dmax}" ]; then
          log "⏸ $inst: zombie ama host GERCEKTEN tikali (D-state=$_dstate ≥ $_dmax) → restart ERTELENDİ (sonraki tur)"
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
        pkill -9 -f "wayland-$inst($|[^0-9])" 2>/dev/null || true
        pkill -9 -f "xdg-$inst($|[^0-9])" 2>/dev/null || true
        pkill -9 -f "waydroid.*--instance $inst($|[^0-9])" 2>/dev/null || true
        pkill -9 -f "lxc-start.*waydroid\.$inst($|[^0-9])" 2>/dev/null || true
        pkill -9 -f "dnsmasq.*waydroid-$inst($|[^0-9])" 2>/dev/null || true
        lxc-stop -n waydroid -P "/var/lib/waydroid.$inst/lxc" -k 2>/dev/null || true
        rm -rf "/run/xdg-$inst" "/run/wd-$inst" "/run/waydroid-$inst-lxc" 2>/dev/null || true
        sleep 3
        # setsid + arka plan: wd-run uzun sürer (~90s boot), bu döngüyü bloklamasın.
        setsid bash "$WD_RUN" "$inst" >/dev/null 2>&1 < /dev/null 9>&- &
        notify AUTO_RECONNECT "$inst" "Instance cokmustu (zombie) - runtime temizlenip yeniden baslatildi" true
        RECONN=$((RECONN+1))
        continue  # boot devam ediyor; proxy'yi bir sonraki tur (cihaz ONLINE olunca) uygular
      else
        # ★★★2026-08-17 OTONOM KURTARMA — BURASI ESKIDEN SADECE LOG YAZIYORDU.
        # Container TAMAMEN olunce (lxc/bridge/dnsmasq YOK) kimse cihazi ayaga
        # kaldirmiyordu -> SONSUZA KADAR OLU (canli: 12 cihaz "IP yok"; mi100/mi102/
        # mi105 4+ SAAT). systemd de kurtarmiyor cunku waydroid@.service
        # Type=simple + RemainAfterExit=yes: wd-run container'i baslatip CIKIYOR,
        # servis "active/exited" kaliyor, Restart=on-failure HIC tetiklenmiyor.
        # Artik cihazi GERCEKTEN baslatiyoruz (dar kapsam + frenlerle).
        _hw_start=0
        if systemctl is-enabled "waydroid@$inst" >/dev/null 2>&1; then
          # (1) D-state kapisi — asil kilit sinyali (ham load Waydroid'de YANILTICI)
          _ds=$(awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0)
          case "$_ds" in ''|*[!0-9]*) _ds=0 ;; esac
          # (2) BOOT DAMGASI grace — az once baslatilmissa DOKUNMA (churn onleme)
          _bage=999999
          if [ -f "/run/wd-boot-$inst" ]; then
            _bt=$(cat "/run/wd-boot-$inst" 2>/dev/null)
            case "$_bt" in ''|*[!0-9]*) _bt="" ;; esac
            [ -n "$_bt" ] && _bage=$(($(date +%s) - _bt))
          fi
          # (3) ardisik basarisizlik freni (DEGRADED ile ayni sayac dosyasi)
          _zf2=$(cat "/var/lib/wd-health/zfail-$inst" 2>/dev/null || echo 0)
          case "$_zf2" in ''|*[!0-9]*) _zf2=0 ;; esac
          if [ "$_ds" -ge "${WD_DSTATE_MAX:-50}" ]; then
            log "⏸ $inst: olu ama host GERCEKTEN tikali (D-state=$_ds) → baslatma ERTELENDI"
          elif [ "$_bage" -lt "${WD_BOOT_GRACE_S:-300}" ]; then
            log "⏳ $inst: yeni baslatilmis (${_bage}s) → tekrar baslatilmadi, boot bekleniyor"
          elif [ "$_zf2" -ge "${WD_ZOMBIE_FAIL_MAX:-6}" ]; then
            log "⛔ $inst: ${_zf2} ardisik basarisiz baslatma → DEGRADED, otomatik deneme durduruldu"
          else
            mkdir -p /var/lib/wd-health 2>/dev/null
            echo $((_zf2 + 1)) > "/var/lib/wd-health/zfail-$inst" 2>/dev/null
            log "🚑 $inst: container YOK (lxc/bridge/dnsmasq) → OTONOM BASLATILIYOR (deneme $((_zf2 + 1)))"
            mark_down "$inst"
            systemctl restart "waydroid@$inst" >/dev/null 2>&1 9>&- &
            _hw_start=1
            RECONN=$((RECONN+1))
          fi
        fi
        if [ "$_hw_start" = "0" ]; then
          log "✗ $inst: erişilemiyor, reconnect başarısız (host-wrapper da yok)"
          notify UNREACHABLE "$inst" "Cihaz ADB'den erişilemiyor, reconnect basarisiz" false
          UNREACH=$((UNREACH+1))
        fi
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
      # ★★★2026-08-20 YARIM-AÇILMIŞ KONTEYNER: proxy çarelerinden ÖNCE boot kontrolü.
      # CANLI KANIT: mi277 + mi290 saatlerce "çıkış ölü" sayılıp 10 dk'da bir sessid
      # döndürdü — ama kök proxy DEĞİLDİ: Android açılmayı hiç bitirmemişti
      # (sys.boot_completed=0). adbd erken kalktığı için adb "device" der; DHCP
      # tamamlanmadığı için cihaz .112 statik yedeğinde kalır, netd resolver YOK ->
      # isim çözülmez -> çıkış alınamaz. Bu hâlde HİÇBİR sessid/hesap rotasyonu işe
      # yaramaz (kanıt: iki cihaz da saatlerce rotasyon yiyip düzelmedi); tek çare
      # konteyneri yeniden başlatmak — elle doğrulandı: ikisi de ~50 sn'de boot=1 +
      # GERÇEK DHCP adresi + TR çıkış aldı.
      # Ölçüm ADRESTEN BAĞIMSIZ (lxc-attach) — bayat/yanlış adb ucundan etkilenmez.
      _bc_dx=$(timeout 8 lxc-attach -n waydroid -P "/var/lib/waydroid.$inst/lxc" -- /system/bin/getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
      # Tek ölçümle karar VERME: yoğun konteynerde lxc-attach 8 sn'de dolabilir ->
      # SAĞLAM cihaz "yarım açılmış" sanılıp boşuna yeniden başlatılır. İkinci ve
      # daha uzun ölçüm bu yanlış pozitifi eler (yalnız başarısızlık yolunda çalışır).
      if [ "$_bc_dx" != "1" ]; then
        sleep 2
        _bc_dx=$(timeout 15 lxc-attach -n waydroid -P "/var/lib/waydroid.$inst/lxc" -- /system/bin/getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')
      fi
      if [ "$_bc_dx" != "1" ]; then
        # ★KORUMA: SİLİNMİŞ cihazı DİRİLTME. Dizin yoksa bu instance artık yok
        # demektir (silinen cihazdan kalan kayıt); systemctl restart onu geri
        # getirirdi. Bu projede komşu/ölü instance'a dokunmak 3 kez ısırdı.
        if [ ! -d "/var/lib/waydroid.$inst/lxc" ]; then
          log "⤫ $inst: instance dizini YOK (silinmiş) — boot kurtarma atlandı"
          continue
        fi
        _dxs="/var/lib/wd-health/bootstuck-$inst"
        _dxa=999999
        [ -f "$_dxs" ] && _dxa=$(( $(date +%s) - $(stat -c %Y "$_dxs" 2>/dev/null || echo 0) ))
        case "$_dxa" in ''|*[!0-9]*) _dxa=999999 ;; esac
        if [ "$_dxa" -lt "${WD_BOOTSTUCK_COOLDOWN_S:-3600}" ]; then
          log "⏳ $inst: boot=${_bc_dx:-yok} (yarım açılmış) — son kurtarma ${_dxa} sn önce, bekleniyor"
        else
          mkdir -p /var/lib/wd-health 2>/dev/null || true
          touch "$_dxs" 2>/dev/null || true
          BOOTFIX=$((BOOTFIX+1))
          log "🔁 $inst: ÇIKIŞ YOK ama kök proxy DEĞİL — konteyner yarım açılmış (boot=${_bc_dx:-yok}) → yeniden başlatılıyor"
          for _P in $(pgrep -f "wd-run.sh $inst\$" 2>/dev/null); do kill -9 "$_P" 2>/dev/null || true; done
          /opt/fleet-agent/waydroid/wd-stop.sh "$inst" >/dev/null 2>&1 || true
          sleep 2
          systemctl restart --no-block "waydroid@$inst.service" >/dev/null 2>&1 || true
          notify DEVICE_BOOT_STUCK "$inst" "Konteyner yarim acilmisti (boot=${_bc_dx:-yok}) - yeniden baslatildi" true
        fi
        continue
      fi
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

# ★★★2026-08-20 PAYLASILAN CIKIS IP ALARMI — KADEMELI.
# Ayni cikis IP'sinden cikan cihazlar WhatsApp tarafinda ILISKILENDIRILEBILIR:
# biri banlanirsa ayni IP'deki digerleri de risk altina girer. Bu filodaki
# "sticky-IP" mimarisi (sessid + sesstime) tam bunun icin kuruldu.
# KADEME (operator istegi: "dusuklerde sorun olmasin ama bilelim"):
#   2-4 cihaz -> yalnizca LOG + /durum'da gorunur, ALARM YOK (mobil havuzda
#                gecici cakisma normaldir; alarm etmek gurultu olur),
#   esik ve uzeri (varsayilan 5) -> havuz daralmis demektir -> ALARM.
# Veri ZATEN wd-saglik.sh ciktisinin 6. alaninda — ek olcum maliyeti YOK.
# TAZELIK: dosya 15 dk'dan eskiyse hic bakma (bayat veriyle alarm uretme).
_SG=/opt/fleet-agent/state/saglik.out
_ESIK="${WD_SHARED_EXIT_ALERT:-5}"
if [ -f "$_SG" ] && [ "$(( $(date +%s) - $(stat -c %Y "$_SG" 2>/dev/null || echo 0) ))" -lt 900 ]; then
  _paycnt=$(cut -d'|' -f6 "$_SG" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' \
            | sort | uniq -c | sort -rn | head -1)
  _paymax=$(printf '%s\n' "$_paycnt" | awk '{print $1+0}')
  _payip=$(printf '%s\n' "$_paycnt" | awk '{print $2}')
  case "$_paymax" in ''|*[!0-9]*) _paymax=0 ;; esac
  if [ "$_paymax" -ge "$_ESIK" ]; then
    _paycih=$(awk -F'|' -v ip="$_payip" '$6==ip {printf "%s ", $1}' "$_SG" 2>/dev/null)
    log "⚠ PAYLASILAN CIKIS: $_paymax cihaz ayni IP'de ($_payip) -> $_paycih"
    notify PROXY_SHARED_EXIT "fleet" "$_paymax cihaz ayni cikis IP sinde ($_payip): $_paycih" false
  elif [ "$_paymax" -ge 2 ]; then
    log "ℹ paylasilan cikis: en buyuk kume $_paymax cihaz ($_payip) — esik $_ESIK, alarm YOK"
  fi
fi
log "TAMAM: $OK sağlıklı, $LEAK sızıntı-düzeltildi, $RECONN reconnect, $UNREACH erişilemez, $DEADEXIT çıkış-ölü (rot=$ROTFIX, hesap=$ACCTFIX, boot-kurtarma=$BOOTFIX)"

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
