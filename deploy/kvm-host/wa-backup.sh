#!/usr/bin/env bash
# Aktif WhatsApp hesabı olan cihazların userdata'sını periyodik yedekler.
# Cihaz çökerse/silinirse hesap kaybolmasın diye com.whatsapp data'yı tar'lar.
# DB'den "hangi instance'ın ACTIVE WhatsApp hesabı var" öğrenir, sadece onları yedekler.
# Günlük systemd timer ile çalışır. Retention: instance başına son 3 yedek tutulur.
set -uo pipefail

BACKUP_DIR="/opt/device-backups"
LOG="/var/log/wa-backup.log"
DATE="$(date +%Y%m%d-%H%M)"
mkdir -p "$BACKUP_DIR"

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

# 1) DB'den aktif-WhatsApp instance'larını al (device.metadata->instance).
#    ACTIVE + RESTRICTED = korunmaya değer canlı hesaplar (BANNED/FAILED atlanır).
INSTANCES=$(docker exec -i fleet-postgres psql -U postgres -d fleet -t -A -c \
  "SELECT DISTINCT d.metadata->>'instance'
   FROM \"Device\" d
   JOIN \"GeneratedAccount\" g ON g.\"deviceId\"=d.id
   WHERE g.platform='whatsapp' AND g.status IN ('ACTIVE','RESTRICTED')
     AND d.metadata->>'instance' IS NOT NULL;" 2>/dev/null | tr -d ' ' | grep -v '^$')

if [ -z "$INSTANCES" ]; then log "yedeklenecek aktif-WhatsApp cihazı yok"; exit 0; fi

COUNT=0; FAILED=0
for inst in $INSTANCES; do
  # WhatsApp userdata iki host-layout'tan birinde olabilir (LITE vs full recipe).
  WADATA=""
  for base in "/root/.local/share/waydroid.$inst/data/data/com.whatsapp" \
              "/root/.local/share-$inst/waydroid/data/data/com.whatsapp"; do
    [ -d "$base" ] && { WADATA="$base"; break; }
  done
  if [ -z "$WADATA" ]; then log "⚠ $inst: com.whatsapp data yok, atlandı"; continue; fi

  OUT="$BACKUP_DIR/wa-$inst-$DATE.tgz"
  # -C ile parent'a geç, sadece com.whatsapp'ı al (yol taşımasın). tar exit kodu:
  #   0 = tam başarı, 1 = "bazı dosyalar okunurken değişti/atlandı" (KISMİ ama geçerli
  #   yedek — WhatsApp çalışırken data değişir, bu normal), 2 = gerçek hata (fatal).
  #   Bu yüzden exit 0 VE 1'i başarı sayarız; sadece ≥2 gerçek başarısızlık.
  tar -czf "$OUT" -C "$(dirname "$WADATA")" com.whatsapp 2>/dev/null
  RC=$?
  if [ "$RC" -le 1 ] && [ -s "$OUT" ]; then
    SZ=$(du -h "$OUT" 2>/dev/null | cut -f1)
    log "✓ $inst yedeklendi ($SZ) → $(basename "$OUT")${RC:+ }"
    COUNT=$((COUNT+1))
    # Retention: bu instance için son 3 yedeği tut, eskiyi sil.
    ls -1t "$BACKUP_DIR/wa-$inst-"*.tgz 2>/dev/null | tail -n +4 | xargs -r rm -f
  else
    log "✗ $inst yedeklenemedi (tar rc=$RC)"; rm -f "$OUT"; FAILED=$((FAILED+1))
  fi
done

log "TAMAM: $COUNT yedeklendi, $FAILED başarısız. Toplam boyut: $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
exit 0
