#!/bin/bash
# ★★★2026-09-12 /durum icin DB OZET URETICISI.
#
# NEDEN AYRI BIR BETIK: durum-uret.sh 10 SANIYEDE BIR doner. Postgres'e tek
# sorgu ~90-140ms suruyor; her turda DB'ye gitmek gunde ~8600 gereksiz sorgu
# demek (ve sayfa uretimi DB'ye BAGIMLI hale gelirdi -- DB yavaslarsa durum
# sayfasi da donardi, ki ariza aninda tam ters sey isteriz).
# Cozum: bu betik 90 saniyede bir olcup DUZ METIN dosyaya yazar; sayfa uretici
# yalnizca dosyayi okur. DB olsun olmasin sayfa her zaman 10sn'de yenilenir.
#
# ★BICIM: "anahtar=deger" satirlari (detay.txt ile ayni desen, ayni okuma
# yardimcisi calisir). Sorgu patlarsa DOSYAYA DOKUNMAZ -- bayat deger gostermek
# yerine "?" gostermek icin yas damgasi da yazilir.
set -o pipefail

OUT=/opt/fleet-agent/state/dbozet.txt
SQL=/opt/fleet-agent/durum-ozet.sql

while true; do
  T0=$(date +%s)
  # ★timeout: DB kilitlenirse bu betik SONSUZA asili kalmasin (bu projede
  # load>100'de docker psql'in asildigi olculdu). 25sn sert tavan.
  RES=$(timeout 25 docker exec -i fleet-postgres psql -U postgres -d fleet -f - < "$SQL" 2>/dev/null)
  RC=$?
  if [ $RC -eq 0 ] && [ -n "$RES" ]; then
    {
      echo "$RES" | grep -E '^[a-z0-9_]+\|'
      echo "olcum_ts=$(date +%s)"
      echo "olcum_saat=$(date +%H:%M)"
      echo "durum=ok"
    } > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
  else
    # Sorgu basarisiz: eski dosyayi SILME (bayat ama bir sey gosterir) ama
    # yas damgasini guncelleme -- sayfa "olcum bayat" diyebilsin.
    echo "$(date '+%F %T') db-ozet basarisiz (rc=$RC)" >> /var/log/wd-durum-db.log
  fi
  # Gecen sureyi dus, tam 90sn periyot tut
  T1=$(date +%s); SLP=$(( 90 - (T1 - T0) )); [ "$SLP" -lt 10 ] && SLP=10
  sleep "$SLP"
done
