#!/usr/bin/env bash
# WhatsApp APK'yı resmi CDN'den (whatsapp.com/android) güncel tutar.
# 2 günde bir systemd timer ile çalışır; provision bu whatsapp.apk'yı kurar,
# böylece her yeni cihaz GÜNCEL resmi WhatsApp ile kurulur ("resmi uygulama" duvarını azaltır).
# Güvenli: sadece geçerli+makul-boyutlu bir APK inerse mevcut dosyayı değiştirir; aksi halde dokunmaz.
set -uo pipefail

APK_DIR="${FLEET_APK_DIR:-/opt/fleet-agent/apks}"
TARGET="$APK_DIR/whatsapp.apk"
TMP="$(mktemp /tmp/wa-apk.XXXXXX.apk)"
UA="Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36"
LOG="/var/log/wa-apk-update.log"

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

# 1) whatsapp.com/android sayfasından TAM APK linkini çek (&amp; → & decode ŞART,
#    yoksa "Bad URL hash" 403 döner — hash query parametreleri kesilir).
PAGE="$(curl -sL -A "$UA" "https://www.whatsapp.com/android/" 2>/dev/null)"
APKURL="$(printf '%s' "$PAGE" | grep -oiE 'https://scontent[^"'"'"'<> ]*WhatsApp\.apk[^"'"'"'<> ]*' | head -1 | sed 's/\&amp;/\&/g')"
if [ -z "$APKURL" ]; then log "HATA: APK linki bulunamadı (sayfa değişmiş olabilir)"; exit 1; fi

# 2) İndir.
if ! curl -sL -A "$UA" -H "Referer: https://www.whatsapp.com/android/" "$APKURL" -o "$TMP" 2>/dev/null; then
  log "HATA: indirme başarısız"; exit 1
fi

# 3) DOĞRULA — geçerli APK mı? (a) ≥ 100MB (bozuk/hata-sayfası küçük olur),
#    (b) ZIP magic bytes "PK\x03\x04" (APK = zip), (c) `file` APK olarak tanıyor.
#    NOT: `unzip` host'ta yok — bu yüzden magic-byte + `file` ile doğrularız (ikisi de
#    çekirdek araç). WhatsApp APK'sı "Bad URL hash" hata sayfası inince 12-byte ASCII olur.
SIZE=$(stat -c%s "$TMP" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 104857600 ]; then log "HATA: dosya çok küçük ($SIZE byte) — muhtemelen hata sayfası, değiştirilmiyor"; exit 1; fi
MAGIC=$(head -c 4 "$TMP" | od -An -tx1 | tr -d ' \n')
if [ "$MAGIC" != "504b0304" ]; then log "HATA: ZIP/APK magic yok (magic=$MAGIC) — geçerli APK değil, değiştirilmiyor"; exit 1; fi
if ! file -b "$TMP" | grep -qi "android package"; then log "HATA: file APK olarak tanımadı — değiştirilmiyor"; exit 1; fi

# 4) Değişti mi? (aynı dosyaysa boşuna yazma)
if [ -f "$TARGET" ] && cmp -s "$TMP" "$TARGET"; then log "değişiklik yok (APK zaten güncel, $SIZE byte)"; exit 0; fi

# 5) Eskisini yedekle + değiştir (atomik: mv aynı dosya sistemi).
[ -f "$TARGET" ] && cp -f "$TARGET" "$TARGET.bak-$(date +%Y%m%d)" 2>/dev/null
mv -f "$TMP" "$TARGET"
chmod 644 "$TARGET"
log "✓ whatsapp.apk GÜNCELLENDİ ($SIZE byte) — sonraki provision'lar bunu kuracak"

# 6) Eski yedekleri buda (son 5 gün).
find "$APK_DIR" -name 'whatsapp.apk.bak-*' -mtime +5 -delete 2>/dev/null
exit 0
