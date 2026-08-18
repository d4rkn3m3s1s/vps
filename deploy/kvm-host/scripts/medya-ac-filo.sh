#!/bin/bash
# WhatsApp MEDYA OTOMATIK INDIRME'yi (roaming) TUM FILODA acar.
#   kullanim: medya-ac-filo.sh [--dry] [limit]
#
# ★★★NEDEN UI (root DEGIL) — CANLI OLCUMLE KANITLANDI 2026-08-18:
#   root ile prefs'e 15 yazildi → WhatsApp acilinca 0'A GERI DONDURDU (sunucudan/
#   bellekten geri yukluyor). UI ile ayarlanan ayni deger ise WA yeniden acildiktan
#   SONRA DA 15 kaldi. Yani tek guvenilir yol UI.
#   (Hafizadaki "duzgun XML ile root kalicidir" notu bu anahtar icin GECERSIZ.)
#
# ★AKIS (her adim ekrandan DOGRULANIR, koordinat sabitlenmez):
#   1) am start .settings.SettingsDataUsageActivity   (surumler arasi SABIT aktivite)
#   2) AŞAĞI KAYDIR — "When roaming" satiri ilk ekranda GORUNMUYOR (onceki kodun
#      kacirdigi adim buydu)
#   3) "When roaming" satirina dokun → diyalog acilir
#   4) 4 kutudan SADECE ISARETSIZ olanlara dokun (isaretliye dokunmak KAPATIR)
#   5) OK → force-stop (prefs flush) → maskeyi OKU ve DOGRULA
#
# ⚠️MESGUL CIHAZ ATLANIR: uzerinde job calisan cihaza UI ile girmek kaydi/gonderimi bozar.

PREF=/data/data/com.whatsapp/shared_prefs/com.whatsapp_preferences_light.xml
DRY=""; LIMIT=9999
for a in "$@"; do case "$a" in --dry) DRY=1;; [0-9]*) LIMIT="$a";; esac; done

# ⚠️IC ICE TIRNAK ANDROID KABUGUNDA BOZULUYOR: `grep -o '..." value="..."'` deseni
# dosya adini donduruyordu (cikti: "<dosya>:autodownload_roaming_mask", deger YOK) ve
# betik her cihazi "BASARISIZ (YOK -> YOK)" sayiyordu — oysa deger dosyada 15'ti.
# COZUM: cihazda YALIN grep calistir, ayristirmayi LINUX tarafinda yap.
mask_of() {
  timeout 10 adb -s "$1" exec-out su -c "grep autodownload_roaming_mask $PREF" 2>/dev/null \
    | tr -d '\r' | sed -n 's/.*value="\([0-9-]*\)".*/\1/p' | head -1
}
dump()    { timeout 15 adb -s "$1" shell uiautomator dump /sdcard/_md.xml >/dev/null 2>&1; timeout 10 adb -s "$1" shell cat /sdcard/_md.xml 2>/dev/null | tr -d '\r'; }
# bounds="[x1,y1][x2,y2]" -> merkez "cx cy"
center()  { echo "$1" | sed -E 's/.*\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\].*/\1 \2 \3 \4/' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }
# metni iceren dugumun bounds'unu ver
node_bounds() { echo "$1" | tr '>' '\n' | grep -F "text=\"$2\"" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1; }

OK=0; FAIL=0; SKIP=0; BUSY=0; N=0
for S in $(adb devices | grep -w device | cut -f1); do
  N=$((N+1)); [ "$N" -gt "$LIMIT" ] && break

  M=$(mask_of "$S")
  if [ "$M" = "15" ]; then SKIP=$((SKIP+1)); continue; fi
  if [ -n "$DRY" ]; then echo "  [kuru] $S roaming=${M:-YOK} -> 15"; continue; fi

  # Mesgul mu? (o an ekranda WA otomasyonu varsa dokunma)
  FOC=$(timeout 8 adb -s "$S" shell dumpsys window 2>/dev/null | grep -oE 'mCurrentFocus=Window\{[^}]*\}' | head -1)
  case "$FOC" in *Conversation*|*Register*|*Verify*) BUSY=$((BUSY+1)); echo "  MESGUL atlandi: $S"; continue;; esac

  timeout 12 adb -s "$S" shell am start -n com.whatsapp/.settings.SettingsDataUsageActivity >/dev/null 2>&1
  sleep 4
  # 2) kaydir — "When roaming" ilk ekranda gorunmuyor
  timeout 8 adb -s "$S" shell input swipe 540 1600 540 900 400 >/dev/null 2>&1
  sleep 2

  D=$(dump "$S")
  B=""
  for T in "When roaming" "Dolaşımdayken" "Dolasimdayken"; do
    B=$(node_bounds "$D" "$T"); [ -n "$B" ] && break
  done
  if [ -z "$B" ]; then echo "  BULUNAMADI (roaming satiri): $S"; FAIL=$((FAIL+1)); continue; fi
  read -r CX CY <<< "$(center "$B")"
  timeout 8 adb -s "$S" shell input tap "$CX" "$CY" >/dev/null 2>&1
  sleep 3

  # 4) SADECE isaretsiz kutulara dokun
  D2=$(dump "$S")
  for T in Photos Audio Videos Documents Fotoğraflar Ses Videolar Belgeler; do
    LINE=$(echo "$D2" | tr '>' '\n' | grep -F "text=\"$T\"" | head -1)
    [ -z "$LINE" ] && continue
    echo "$LINE" | grep -q 'checked="true"' && continue          # zaten acik -> DOKUNMA
    BB=$(echo "$LINE" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1)
    [ -z "$BB" ] && continue
    read -r X Y <<< "$(center "$BB")"
    timeout 8 adb -s "$S" shell input tap "$X" "$Y" >/dev/null 2>&1
    sleep 1
  done

  # 5) OK
  D3=$(dump "$S")
  OKB=""
  for T in OK Tamam TAMAM; do OKB=$(node_bounds "$D3" "$T"); [ -n "$OKB" ] && break; done
  if [ -n "$OKB" ]; then read -r OX OY <<< "$(center "$OKB")"; timeout 8 adb -s "$S" shell input tap "$OX" "$OY" >/dev/null 2>&1; fi
  sleep 2
  # force-stop: prefs'i diske FLUSH eder (deger dosyaya yazilsin diye SART)
  timeout 8 adb -s "$S" shell am force-stop com.whatsapp >/dev/null 2>&1
  sleep 2

  M2=$(mask_of "$S")

  # ★★★2026-08-18 WhatsApp'i GERI BASLAT — kritik.
  # Ilk surumde force-stop'tan sonra WA kapali BIRAKILIYORDU. WA kapaliyken cihaza
  # mesaj ULASMIYOR (sunucuda kuyruklanir) → filo boyunca gelen mesaj gecikmesi
  # yaratirdi. CANLI KANIT: 192.168.12.237'de wa_surec=YOK, kurulu_soket=0.
  timeout 15 adb -s "$S" shell am start -n com.whatsapp/com.whatsapp.home.ui.HomeActivity >/dev/null 2>&1
  sleep 2
  if [ "$M2" = "15" ]; then OK=$((OK+1)); echo "  OK: $S (${M:-YOK} -> 15)"; else FAIL=$((FAIL+1)); echo "  BASARISIZ: $S (${M:-YOK} -> ${M2:-YOK})"; fi
done

echo "--- SONUC ---"
echo "  acildi: $OK   zaten acik: $SKIP   basarisiz: $FAIL   mesgul-atlandi: $BUSY"
