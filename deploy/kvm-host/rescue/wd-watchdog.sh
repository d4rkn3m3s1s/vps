#!/bin/bash
# 2026-08-14 SYSTEMD WATCHDOG - kademeli otomatik kurtarma + TELEGRAM ONAYLI reboot.
#
# NEDEN: 14 Agustos'ta sistem UC KEZ kilitlendi, her seferinde INSAN mudahalesi
# (IPMI power cycle) gerekti; sabahki kilit 5 SAAT surdu. Kilidin imzasi hep ayni:
#   systemctl yanit vermiyor + SSH girisi acilmiyor, AMA cihazlar calisiyor.
#
# ASIL SINYAL: systemd yanit suresi.
#   (D-state ve load YANILTICI oldugu OLCULDU: kilit anlarinda D=1-6 ve
#    CPU %60-85 BOSTA idi. Bu yuzden esik systemd yanitina baglandi.)
#
# KADEMELER (30 sn'de bir olcum):
#   1) 10 ust uste kotu (~5 dk)  -> acilis/onarim BETIKLERINI oldur   [OTOMATIK]
#   2) 20 ust uste kotu (~10 dk) -> agent + bekleyen kapilari oldur   [OTOMATIK]
#   3) 40 ust uste kotu (~20 dk) -> TELEGRAM'a reboot ONAY LINKI yolla [ONAY GEREKIR]
# Reboot ASLA kendiliginden yapilmaz -- kullanici Telegram'daki linke basmalidir.
# Herhangi bir saglikli olcum sayaclari SIFIRLAR.
#
# TASARIM: 1. ve 2. kademe systemd'ye BAGIMLI DEGIL (tikaliyken de calisir).
L=/var/log/wd-watchdog.log
TOKEN_FILE=/opt/fleet-agent/state/kurtar.token
say(){ echo "$(date +%H:%M:%S) $*" >> "$L"; }

sd_ms(){
  local s e rc
  s=$(date +%s%N); timeout 8 systemctl is-system-running >/dev/null 2>&1; rc=$?
  e=$(date +%s%N)
  [ "$rc" -eq 124 ] && { echo 9999; return; }
  echo $(( (e - s) / 1000000 ))
}
dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0; }

# --- Telegram ayarlarini bilinen yerlerden bul (agent/API env dosyalari)
# ★ 2026-08-14: GERCEK yol /opt/fleet/apps/api/.env cikti. Ilk surumde bu yol
#   listede YOKTU -> bildirimler SESSIZCE gitmiyordu (tg_ayar bos donuyordu).
#   Bu tur "sessiz basarisizlik" en tehlikelisi: watchdog calisiyor sanilir.
#   chatId API'de AES-256-GCM SIFRELI saklaniyor (NotificationChannel.configEnc),
#   kabuktan okunamaz -> kilit aninda DB'ye bagimli olmamak icin ayri dosyada:
#   /opt/fleet-agent/state/tg.conf  (TG_CHAT=...)   Bot anahtari env'de aciktir.
tg_ayar(){
  local f
  [ -r /opt/fleet-agent/state/tg.conf ] && . /opt/fleet-agent/state/tg.conf 2>/dev/null
  for f in /opt/fleet/apps/api/.env /opt/fleet-agent/agent.env /opt/fleet-agent/.env /opt/vps-emulator-platform/apps/api/.env /opt/api/.env; do
    [ -r "$f" ] || continue
    [ -z "${TG_BOT:-}" ] && TG_BOT=$(grep -m1 -E '^(TELEGRAM_BOT_TOKEN|TG_BOT_TOKEN)=' "$f" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r')
    [ -z "${TG_CHAT:-}" ] && TG_CHAT=$(grep -m1 -E '^(TELEGRAM_CHAT_ID|TG_CHAT_ID)=' "$f" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' \r')
  done
}

tg_gonder(){
  local msg="$1"
  tg_ayar
  if [ -z "${TG_BOT:-}" ] || [ -z "${TG_CHAT:-}" ]; then
    say "    TELEGRAM AYARI YOK -> mesaj gonderilemedi"
    return 1
  fi
  timeout 20 curl -s -o /dev/null -X POST \
    "https://api.telegram.org/bot${TG_BOT}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" \
    --data-urlencode "text=${msg}" \
    --data-urlencode "disable_web_page_preview=true" 2>/dev/null
}

ESIK_MS=8000
KOTU=0
SEVIYE=0

say "=== WATCHDOG BASLADI (esik ${ESIK_MS}ms, reboot ONAYLI) ==="

while true; do
  MS=$(sd_ms)

  if [ "$MS" -gt "$ESIK_MS" ]; then
    KOTU=$((KOTU+1))
    [ $((KOTU % 4)) -eq 1 ] && say "systemd yavas: ${MS}ms (ust uste $KOTU) D=$(dblocked)"

    # --- KADEME 1: en sik sebep benim acilis/onarim betiklerim
    if [ "$KOTU" -ge 10 ] && [ "$SEVIYE" -lt 1 ]; then
      SEVIYE=1
      say "!!! KADEME 1 (5dk): acilis/onarim betikleri olduruluyor"
      pkill -f 'wd-cozul\.sh|wd-kademeli\.sh|wd-onar\.sh|wd-adb-tara\.sh|wd-boot-toparla\.sh' 2>/dev/null
      say "    betikler kesildi"
      tg_gonder "⚠️ Watchdog KADEME 1: systemd ${MS}ms yanit veriyor (5 dk). Acilis/onarim betikleri otomatik durduruldu. Cihazlar calismaya devam ediyor."
    fi

    # --- KADEME 2: agent + takili boot-gate kapilari
    if [ "$KOTU" -ge 20 ] && [ "$SEVIYE" -lt 2 ]; then
      SEVIYE=2
      say "!!! KADEME 2 (10dk): agent + bekleyen kapilar olduruluyor"
      pkill -f '/opt/agent\.mjs' 2>/dev/null
      pkill -f 'wd-boot-gate\.sh' 2>/dev/null
      say "    agent + kapilar kesildi (CIHAZLAR KAPATILMADI)"
      tg_gonder "🔴 Watchdog KADEME 2: sistem 10 dk'dir toparlamadi. fleet-agent ve bekleyen acilis kapilari durduruldu. CIHAZLAR KAPATILMADI."
    fi

    # --- KADEME 3: REBOOT -- OTOMATIK DEGIL, TELEGRAM ONAYI ISTER
    if [ "$KOTU" -ge 40 ] && [ "$SEVIYE" -lt 3 ]; then
      SEVIYE=3
      TK=$(cat "$TOKEN_FILE" 2>/dev/null)
      say "!!! KADEME 3 (20dk): reboot ONAYI isteniyor (otomatik reboot YOK)"
      if [ -n "$TK" ]; then
        tg_gonder "🚨 SUNUCU KILITLI — 20 dakikadir systemd yanit vermiyor (${MS}ms).
Betikler ve agent durduruldu ama sistem toparlamadi.

Yeniden baslatmak icin bu baglantiya bas (SADECE SEN onaylayabilirsin):
http://125.253.73.45/kurtar/eylem?ad=reboot-zorla&onay=evet&token=${TK}

Once durumu gormek istersen:
http://125.253.73.45/kurtar/durum?token=${TK}

NOT: Otomatik yeniden baslatma YAPILMAYACAK. Karar sende."
      else
        tg_gonder "🚨 SUNUCU KILITLI — 20 dakikadir systemd yanit vermiyor. Kurtarma token'i bulunamadi, IPMI konsolundan mudahale gerekiyor."
      fi
      say "    Telegram onay mesaji gonderildi"
    fi
  else
    if [ "$KOTU" -gt 0 ]; then
      say "normale dondu: ${MS}ms (kotu $KOTU -> 0, seviye $SEVIYE -> 0)"
      [ "$SEVIYE" -ge 1 ] && tg_gonder "✅ Sistem normale dondu: systemd ${MS}ms. Watchdog sayaclari sifirlandi."
    fi
    KOTU=0
    SEVIYE=0
  fi

  sleep 30
done
