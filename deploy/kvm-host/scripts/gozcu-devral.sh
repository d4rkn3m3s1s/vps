#!/bin/bash
# systemd DISINDA baslatilmis cihazlari systemd supervizyonuna DEVRETTIRIR.
#
# ★SORUN: kurulum akisi yeni cihazlari `systemctl start` ile DEGIL, dogrudan
# baslatiyor. Sonuc: birim `enabled` ama `inactive/dead`; container ve wd-run
# CALISIYOR, ancak systemd onlari SAHIPLENMIYOR. Gozcu "container oldu" deyip
# `exit 1` yapsa bile systemd bunu GORMEZ → otomatik kurtarma zinciri KOPUK.
# ★OLCUM: ADB'de bagli 151 cihazin 48'i bu durumdaydi (hepsi yeni kurulanlar).
#
# ★GUVENLI: wd-run'un "zaten calisiyor → GOZETIM devralindi" yolu container'i
# YENIDEN KURMAZ, yalnizca gozetimi ustlenir. Canli kanit (mi366):
#   birim inactive/dead → active/running · lxc 1 → 1 (ayni) · ADB kopmadi
#   journal: "zaten calisiyor — yeniden kurulmadi, GOZETIM devralindi" + WATCHDOG_START

OK=0; ATLA=0; HATA=0
for S in $(adb devices | grep -w device | cut -f1); do
  OKT=$(echo "${S%%:*}" | cut -d. -f3)
  I=$(grep -E " $OKT\$" /var/lib/waydroid-subnets.map 2>/dev/null | awk '{print $1}' | head -1)
  [ -z "$I" ] && continue
  SUB=$(systemctl show "waydroid@$I" -p SubState --value 2>/dev/null)
  [ "$SUB" = "running" ] && { ATLA=$((ATLA+1)); continue; }
  sudo systemctl start "waydroid@$I" >/dev/null 2>&1
  sleep 6
  SUB2=$(systemctl show "waydroid@$I" -p SubState --value 2>/dev/null)
  if [ "$SUB2" = "running" ]; then
    OK=$((OK+1)); echo "  devraldi: $I"
  else
    HATA=$((HATA+1)); echo "  BASARISIZ: $I ($SUB2)"
  fi
done
echo "--- SONUC ---"
echo "  devralindi: $OK   zaten vardi: $ATLA   basarisiz: $HATA"
echo "  adb bagli: $(adb devices | grep -cw device)"
