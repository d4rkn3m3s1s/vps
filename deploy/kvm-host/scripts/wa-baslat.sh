#!/bin/bash
# WhatsApp KAPALI kalan cihazlarda WA'yi yeniden baslatir.
#
# ★NEDEN: medya-ac betiginin ilk surumu maskeyi yazdiktan sonra `am force-stop`
# yapiyor ama WA'yi GERI BASLATMIYORDU. WA kapaliyken cihaza mesaj ULASMAZ
# (WhatsApp sunucusunda kuyruklanir) → gelen mesaj gecikmesi.
# CANLI KANIT: 192.168.12.237 wa_surec=YOK, kurulu_soket=0.
#
# Salt-tamir: yalnizca WA'si KAPALI olanlara dokunur, calisanlari rahat birakir.

BASLATILDI=0; ZATEN=0; HATA=0
for S in $(adb devices | grep -w device | cut -f1); do
  PID=$(timeout 8 adb -s "$S" shell pidof com.whatsapp 2>/dev/null | tr -d '\r')
  if [ -n "$PID" ]; then ZATEN=$((ZATEN+1)); continue; fi
  # ⚠️`monkey` bu cihazlarda WA_yi BASLATMIYOR (sessizce doner, surec olusmaz).
  # Calisan tek yol: acik aktivite adiyla `am start`.
  timeout 15 adb -s "$S" shell am start -n com.whatsapp/com.whatsapp.home.ui.HomeActivity >/dev/null 2>&1
  sleep 3
  PID2=$(timeout 8 adb -s "$S" shell pidof com.whatsapp 2>/dev/null | tr -d '\r')
  if [ -n "$PID2" ]; then BASLATILDI=$((BASLATILDI+1)); echo "  baslatildi: $S"; else HATA=$((HATA+1)); echo "  BASLATILAMADI: $S"; fi
done
echo "--- SONUC ---"
echo "  baslatildi: $BASLATILDI   zaten calisiyordu: $ZATEN   basarisiz: $HATA"
