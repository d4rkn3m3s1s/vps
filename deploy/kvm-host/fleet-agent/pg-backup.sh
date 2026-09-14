#!/usr/bin/env bash
# PostgreSQL günlük yedek — fleet DB. pg_dump salt-okunur (MVCC snapshot), tabloyu kilitlemez.
set -uo pipefail
DIR=/opt/db-backups
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M)
OUT="$DIR/fleet-$TS.sql.gz"
# --clean --if-exists: restore mevcut şemayı temiz üzerine yazar.
if docker exec fleet-postgres pg_dump -U postgres -d fleet --clean --if-exists | gzip > "$OUT" && [ -s "$OUT" ]; then
  # Retention: son 14 dump (2 hafta)
  ls -1t "$DIR"/fleet-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
  echo "$(date '+%F %T') OK $(du -h "$OUT" | cut -f1) $OUT"
else
  echo "$(date '+%F %T') DUMP FAIL"; rm -f "$OUT"; exit 1
fi

# ★★★2026-09-15 OFF-SITE KOPYA (ikinci fiziksel disk).
# Yedekler kok diskteydi; kok disk giderse yedek de giderdi.
# nvme1n1 -> /mnt/yedek (fstab'da nofail). --delete YOK: oradaki
# gecmis kaynaktaki retention'dan BAGIMSIZ, daha uzun kalsin.
# Hata yedek betigini kirmaz (|| true): asil is zaten bitti.
if mountpoint -q /mnt/yedek 2>/dev/null; then
  rsync -a --quiet $DIR/ /mnt/yedek/db-backups/ 2>/dev/null || true
else
  echo "$(date '+%F %T') UYARI: /mnt/yedek bagli degil — off-site kopya ATLANDI"
fi
