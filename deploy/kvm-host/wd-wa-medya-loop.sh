#!/bin/bash
# Tek cihaz icin medya izleyici dongusu (TEST modu).
#
# 8 sn'de bir kontrol -- tek gosterimlik medya GORULDUKTEN SONRA silindigi icin
# aralik SIK olmali (normal medya beklerdi ama view-once icin sart).
#
# ★SISTEMI YORMAZ: her tur SADECE msgstore'a tek SQL sorgusu (yeni _id > pozisyon).
#   Dosya sistemi TARANMAZ, ps/top YOK (14 Agu kilit dersi). Cihaza tek adb
#   baglantisi. Bos turda (yeni medya yok) neredeyse sifir yuk.
S="${1:?serial gerekli}"
DEVNO="${2:-}"
while true; do
  /opt/fleet-agent/wd-wa-medya.sh "$S" "$DEVNO" >> /var/log/wd-wa-medya.log 2>&1
  sleep 8
done
