#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# /durum için DB ÖZET ÜRETİCİSİ
#
# 2026-09-12 v1  özet metrikleri (dbozet.txt)
# 2026-09-12 v2  ★ cihaz tablosu eklendi (cihazlar.txt) — 144 satır, aranabilir
#
# ★NEDEN AYRI SERVİS: durum-uret.sh 10 SANİYEDE BİR döner. Postgres'e tek sorgu
# ~90-180 ms; her turda DB'ye gitmek günde ~8600 gereksiz sorgu demek VE sayfa
# üretimini DB'ye BAĞIMLI kılar — DB yavaşlarsa durum sayfası da donar, ki arıza
# anında tam ters şey isteriz. Bu betik 90 sn'de bir ölçüp DÜZ METNE yazar;
# sayfa üretici yalnızca dosyayı okur. DB olsun olmasın sayfa 10 sn'de yenilenir.
#
# ★ÇIKTI BİÇİMİ: "anahtar|değer[|değer...]" satırları (detay.txt ile aynı desen).
# Sorgu patlarsa DOSYAYA DOKUNMAZ — bayat değer göstermektense sayfa "ölçülemedi"
# desin diye yaş damgası ayrı yazılır.
#
# ★psql -f DOSYA YOLU TUZAĞI: `-f /opt/...` container İÇİNDE arar, host'ta değil.
# Bu yüzden SQL stdin'den beslenir (`-f -` + yönlendirme). İlk sürümde tam bu
# hata vardı ve dosya hiç üretilmedi.
# ══════════════════════════════════════════════════════════════════════════════
set -o pipefail

OUT=/opt/fleet-agent/state/dbozet.txt
OUTC=/opt/fleet-agent/state/cihazlar.txt
SQL=/opt/fleet-agent/durum-ozet.sql
SQLC=/opt/fleet-agent/durum-cihaz.sql
LOG=/var/log/wd-durum-db.log

while true; do
  T0=$(date +%s)

  # ── (1) ÖZET METRİKLER ────────────────────────────────────────────────────
  # ★timeout: DB kilitlenirse bu betik SONSUZA asılı kalmasın (bu projede
  # load>100'de docker psql'in asıldığı ölçüldü). 25 sn sert tavan.
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
    echo "$(date '+%F %T') ozet basarisiz (rc=$RC)" >> "$LOG"
  fi

  # ── (2) CİHAZ TABLOSU ─────────────────────────────────────────────────────
  # ★Ayrı sorgu, ayrı dosya: 144 satır döndürür. Özet bozulursa tablo, tablo
  # bozulursa özet ayakta kalsın. Ölçülen maliyet: 90 ms (tek geçiş JOIN).
  # ★Satırlar en çok BAŞARISIZ işi olan cihaz üstte gelecek şekilde sıralı —
  # operatör sorunlu cihazı aramak zorunda kalmasın.
  RESC=$(timeout 25 docker exec -i fleet-postgres psql -U postgres -d fleet -f - < "$SQLC" 2>/dev/null)
  RCC=$?
  if [ $RCC -eq 0 ] && [ -n "$RESC" ]; then
    {
      echo "$RESC" | grep -E '^c\|'
      echo "cihaz_ts=$(date +%s)"
    } > "$OUTC.tmp" && mv "$OUTC.tmp" "$OUTC"
  else
    echo "$(date '+%F %T') cihaz tablosu basarisiz (rc=$RCC)" >> "$LOG"
  fi

  # Geçen süreyi düş, tam 90 sn periyot tut
  T1=$(date +%s); SLP=$(( 90 - (T1 - T0) )); [ "$SLP" -lt 10 ] && SLP=10
  sleep "$SLP"
done
