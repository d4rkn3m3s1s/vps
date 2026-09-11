#!/bin/bash
# ── WhatsApp GELEN MEDYA -> Telegram ──────────────────────────────────────────
#
# ★★★NEDEN GEREKLI: gelen foto/video bildirimde sadece "📷 Photo" olarak gorunur;
#   dosyanin kendisi bildirimden ALINAMAZ. Dosya ancak WhatsApp onu diske
#   indirdiginde olusur ve msgstore.message_media.file_path'e yazilir.
#
# ★★★ONKOSUL (14-15 Agu kanit): WhatsApp rehberde OLMAYAN numaradan gelen medyayi
#   INDIRMEZ -> log: isAutoDownloadEligible/false reason=notReliableContact.
#   Bu yuzden bu betik once REHBERI TAMAMLAR (bilinmeyen numarayi ekler), sonra
#   inen dosyalari Telegram'a yollar.
#
# ★IZIN TUZAGI: `su -c content ...` uid=1000 (system) olur ve SecurityException
#   verir. Izin com.android.shell'e verilir, komut da su OLMADAN calistirilir.
#
# ★SISTEMI YORMAZ: dosya sistemi TARANMAZ; msgstore'a tek SQL sorgusu atilir
#   (son islenen _id'den buyukler). 14 Agu dersi: tarama = kilit.
set -u
S="${1:?adb serial gerekli}"
DEVNO="${2:-}"                       # cihazin numarasi (mesajda gosterilir)
STATE_DIR=/opt/fleet-agent/state/wa-medya
mkdir -p "$STATE_DIR"
POS="$STATE_DIR/$(echo "$S" | tr ':.' '__').pos"   # son islenen message _id

A(){ adb -s "$S" "$@" 2>/dev/null | tr -d '\r'; }
sur(){ local b; b=$(printf '%s' "$1" | base64 -w0); A shell "su -c 'echo $b | base64 -d | sh'"; }

DB=/data/data/com.whatsapp/databases/msgstore.db
MEDIA_ROOT=/data/media/0/Android/media/com.whatsapp/WhatsApp

# ── Telegram ayarlari (API .env + fleet state) ────────────────────────────────
TG_BOT=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' /opt/fleet/apps/api/.env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r')
TG_CHAT=$(grep -m1 '^TG_CHAT=' /opt/fleet-agent/state/tg.conf 2>/dev/null | cut -d= -f2- | tr -d ' \r')
[ -z "$TG_BOT" ] && { echo "TELEGRAM_BOT_TOKEN yok"; exit 1; }
[ -z "$TG_CHAT" ] && { echo "TG_CHAT yok"; exit 1; }

# ── 1) REHBERI TAMAMLA (medyanin inmesi icin ONKOSUL) ─────────────────────────
rehberTamamla(){
  A shell "pm grant com.android.shell android.permission.WRITE_CONTACTS" >/dev/null 2>&1
  A shell "pm grant com.android.shell android.permission.READ_CONTACTS"  >/dev/null 2>&1
  local nums n var rid eklendi=0
  nums=$(sur "sqlite3 $DB \"SELECT DISTINCT user FROM jid WHERE server='s.whatsapp.net' AND length(user) BETWEEN 10 AND 15;\"")
  for n in $nums; do
    [ "$n" = "$DEVNO" ] && continue
    var=$(A shell "content query --uri content://com.android.contacts/data --projection data1 --where \"data1='+$n'\"" | grep -c 'data1')
    [ "$var" -gt 0 ] && continue
    A shell "content insert --uri content://com.android.contacts/raw_contacts --bind account_name:s:fleet --bind account_type:s:fleet" >/dev/null 2>&1
    rid=$(A shell "content query --uri content://com.android.contacts/raw_contacts --projection _id --sort '_id DESC'" | head -1 | grep -oE '_id=[0-9]+' | cut -d= -f2)
    [ -z "$rid" ] && continue
    A shell "content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:$rid --bind mimetype:s:vnd.android.cursor.item/name --bind data1:s:WA$n" >/dev/null 2>&1
    A shell "content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:$rid --bind mimetype:s:vnd.android.cursor.item/phone_v2 --bind data1:s:+$n --bind data2:i:2" >/dev/null 2>&1
    eklendi=$((eklendi+1))
  done
  [ "$eklendi" -gt 0 ] && echo "rehber: $eklendi yeni kisi eklendi"
  return 0
}

# ── 2) YENI INEN MEDYAYI BUL (tek SQL, tarama yok) ────────────────────────────
SON=$(cat "$POS" 2>/dev/null || echo 0)
rehberTamamla

# ★TEK GOSTERIMLIK (view once) ozel durumu -- CANLI OLCUM (15 Agu):
#   - AYRI message_type kullanir: 42 (13 DEGIL)
#   - dosyasi genel medya klasorunde DEGIL, uygulamanin gizli dizininde:
#       /data/user/0/com.whatsapp/files/ViewOnce/IMG-xxxx.jpg
#   - file_path MUTLAK yol doner -> basina MEDIA_ROOT eklenmemeli
#   - GORULDUKTEN SONRA SILINIR -> once davranmak sart (first_viewed_timestamp=0
#     iken yakalanmali). Bu yuzden izleyici sik calismali.
#   Ayrimi `message_view_once_media` tablosuyla JOIN yaparak yapiyoruz.
SATIRLAR=$(sur "sqlite3 $DB \"SELECT m._id||'|'||m.message_type||'|'||coalesce(mm.file_path,'')||'|'||coalesce(j.user,'?')||'|'||datetime(m.timestamp/1000,'unixepoch','+3 hours')||'|'||CASE WHEN v.message_row_id IS NULL THEN '0' ELSE '1' END FROM message m JOIN message_media mm ON mm.message_row_id=m._id LEFT JOIN chat c ON c._id=m.chat_row_id LEFT JOIN jid j ON j._id=c.jid_row_id LEFT JOIN message_view_once_media v ON v.message_row_id=m._id WHERE m.from_me=0 AND m._id>$SON AND mm.file_path IS NOT NULL AND mm.file_path<>'' ORDER BY m._id;\"")

[ -z "$SATIRLAR" ] && { echo "yeni medya yok (son id=$SON)"; exit 0; }

YENISON=$SON
echo "$SATIRLAR" | while IFS='|' read -r ID TIP YOL GONDEREN ZAMAN TEKG; do
  [ -z "$ID" ] && continue
  # Mutlak yol (tek gosterimlik) ise oldugu gibi kullan; degilse medya kokune ekle.
  case "$YOL" in
    /*) TAM="$YOL" ;;
    *)  TAM="$MEDIA_ROOT/$YOL" ;;
  esac
  YEREL="/tmp/wa-medya-$ID-$(basename "$YOL")"

  # Dosyayi cihazdan cek (root okuma gerekli -> once /sdcard'a kopyala)
  sur "cp '$TAM' /sdcard/.wa-tmp 2>/dev/null && chmod 644 /sdcard/.wa-tmp"
  A pull /sdcard/.wa-tmp "$YEREL" >/dev/null 2>&1
  sur "rm -f /sdcard/.wa-tmp"
  [ ! -s "$YEREL" ] && { echo "  #$ID dosya cekilemedi ($YOL)"; continue; }

  # Tip 42 = tek gosterimlik; icerigi uzantidan anlariz (foto/video olabilir).
  case "$TIP" in
    1)  UC=sendPhoto;    ALAN=photo ;;
    3)  UC=sendVideo;    ALAN=video ;;
    2)  UC=sendAudio;    ALAN=audio ;;
    42) case "$YOL" in
          *.mp4|*.MP4|*.mov) UC=sendVideo; ALAN=video ;;
          *)                 UC=sendPhoto; ALAN=photo ;;
        esac ;;
    *)  UC=sendDocument; ALAN=document ;;
  esac
  BASLIK="📎 WhatsApp medya
📱 Cihaz: +${DEVNO:-?}
👤 Gönderen: $GONDEREN
🕒 $ZAMAN"
  # Tek gosterimlik: goruldukten SONRA silinir -> yakalandigi acikca yazilsin.
  [ "${TEKG:-0}" = "1" ] && BASLIK="👁 TEK GÖSTERİMLİK (kalıcı kopya alındı)
$BASLIK"

  R=$(curl -s --max-time 60 -X POST "https://api.telegram.org/bot${TG_BOT}/${UC}" \
        -F "chat_id=${TG_CHAT}" -F "caption=${BASLIK}" -F "${ALAN}=@${YEREL}")
  if printf '%s' "$R" | grep -q '"ok":true'; then
    echo "  #$ID -> TG gonderildi ($ALAN)"
  else
    echo "  #$ID TG HATA: $(printf '%s' "$R" | head -c 120)"
  fi
  rm -f "$YEREL"
  echo "$ID" > "$POS.tmp"
done

[ -f "$POS.tmp" ] && mv "$POS.tmp" "$POS"
echo "bitti (son id=$(cat "$POS" 2>/dev/null || echo "$SON"))"
