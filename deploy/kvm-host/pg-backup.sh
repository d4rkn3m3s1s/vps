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
