#!/bin/bash
# 2026-08-14 REBOOT SONRASI OTONOM TOPARLAMA
# Sira: liste tazele -> YENI cihazlari kaydet -> cihazlar acilsin -> ADB bagla -> agent -> health-watch
L=/var/log/wd-boot-toparla.log
LIST=/opt/fleet-agent/state/all_inst.txt
say(){ echo "$(date +%H:%M:%S) $*" >> "$L"; }
# ★2026-08-20 TELEGRAM BILDIRIMI. Bu servis reboot sonrasi filoyu KENDI KENDINE
# toparliyor — ama operatore HIC haber vermiyordu. 20 Agu'de sunucu 09:49'da
# saglayici tarafindan yeniden baslatildi ve operator durumu ancak saatler sonra
# fark etti. Artik: acilista "toparlaniyor", bitince "toparlandi", firtinada
# "el mudahalesi gerekli" mesaji gider. wd-watchdog ile AYNI kanal/ayar dosyasi.
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
    say "  (telegram ayari yok - bildirim atlandi)"
    return 0
  fi
  timeout 20 curl -s -o /dev/null -X POST \
    "https://api.telegram.org/bot${TG_BOT}/sendMessage" \
    --data-urlencode "chat_id=${TG_CHAT}" \
    --data-urlencode "text=${msg}" \
    --data-urlencode "disable_web_page_preview=true" 2>/dev/null || true
  return 0
}
# ★2026-08-20 ZAMAN ASIMI EKLENDI. Ikisi de BOOT sirasinda, sistem tikaliyken
# cagriliyor. `systemctl list-units` systemd jammed iken SONSUZA KADAR bekler
# (14 Agu'de tam bu oldu: tur 19:05'te D=154 ile kesildi ve bir daha satir
# yazilmadi). `adb devices` de adb sunucusu takildiysa asili kalir.
# wd-izle.sh ayni dersi ogrenip `timeout 6 systemctl` kullaniyor — ayni koruma.
# ★2026-08-20 ZAMAN ASIMI + SAYI GUVENCESI.
# (a) Ikisi de BOOT sirasinda, sistem tikaliyken cagriliyor. `systemctl list-units`
#     systemd jammed iken SONSUZA KADAR bekler — 14 Agu'de tam bu oldu: tur 19:05'te
#     D=154 ile kesildi ve bir daha satir yazilmadi. `adb devices` de adb sunucusu
#     takilirsa asili kalir. wd-izle.sh ayni dersi ogrenip `timeout 6 systemctl` kullanir.
# (b) `|| echo 0` KULLANMA: `grep -c` eslesme yoksa ZATEN "0" basar VE exit 1 doner,
#     yani `|| echo 0` ikinci bir "0" satiri daha ekler -> "$A" iki satirlik olur ve
#     `[ "$A" -ge N ]` patlar. Sayi guvencesi `case` ile veriliyor.
_num(){ case "$1" in ''|*[!0-9]*) echo 0 ;; *) echo "$1" ;; esac; }
acik(){ _num "$(timeout 10 systemctl list-units --state=running "waydroid@*" 2>/dev/null | grep -c waydroid@)"; }
adbn(){ _num "$(timeout 15 adb devices 2>/dev/null | grep -c "device$")"; }
dst(){ _num "$(awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null)"; }
# ★★★2026-08-20 YASAKLI TARAMA KALDIRILDI. Eski hali:
#   dst(){ ps -eo stat | grep -c "^D"; }
# `ps -eo stat` /proc'un TAMAMINI tarar (bu hostta yuz binlerce thread) ve tam da
# BOOT sirasinda — sistemin en yuklu aninda — cagriliyordu. 14 Agu'de sistemi UC
# KEZ kilitleyen sey buydu (SSH bile oldu). Ucuz ve DENK karsiligi: cekirdegin
# kendi sayaci, tek kucuk dosya okumasi, /proc taramasi YOK.

say "=== BOOT TOPARLAMA BASLADI ==="
tg_gonder "🔄 Sunucu yeniden basladi — filo otomatik toparlanmaya basladi. (boot-toparla)"

# Liste tazele (yeni kurulan cihazlar dahil olsun)
/opt/fleet-agent/wd-inst-liste.sh
TOP=$(wc -l < "$LIST")
say "instance listesi: $TOP"

# 0) YENI CIHAZLARI systemd ye KAYDET
# Kurulduktan sonra reboot olursa acilmazlardi -- bu adim onu kapatir.
YENI=0
while read -r inst; do
  [ -z "$inst" ] && continue
  if ! systemctl is-enabled --quiet "waydroid@$inst" 2>/dev/null; then
    systemctl enable "waydroid@$inst" >/dev/null 2>&1 && YENI=$((YENI+1))
  fi
done < "$LIST"
if [ "$YENI" -gt 0 ]; then
  say "YENI kaydedilen cihaz: $YENI (bundan sonra reboot ta otomatik acilir)"
  systemctl start "waydroid@*" --no-block 2>/dev/null
fi

# 1) Cihazlarin acilmasini bekle (boot-gate kademeli acar)
ONCE=0; SABIT=0
for i in $(seq 1 180); do
  sleep 15
  A=$(acik)
  if [ "$A" -ge $(( TOP * 85 / 100 )) ]; then say "hedefe ulasildi: $A/$TOP"; break; fi
  if [ "$A" -eq "$ONCE" ]; then SABIT=$((SABIT+1)); else SABIT=0; fi
  ONCE=$A
  if [ "$SABIT" -ge 12 ]; then say "artis durdu: $A/$TOP (3dk sabit)"; break; fi
  [ $((i % 8)) -eq 0 ] && say "  acilis: $A/$TOP D=$(dst)"
done

# 2) Acilmayanlari kademeli tetikle
say "kalanlari tetikliyorum (acik=$(acik))"
# ★★★2026-08-20 BU ADIM SESSIZCE HICBIR SEY YAPMIYORDU.
# Eski hali `systemctl start wd-kademeli` idi — ama BOYLE BIR BIRIM YOK
# (`systemctl is-enabled wd-kademeli` -> not-found). Hata `2>/dev/null` ile
# yutuluyor, hemen ardindaki bekleme dongusu de `is-active` yanlis donunce
# ANINDA break ediyordu. Yani "acilmayanlari tetikle" adimi hic calismadi.
# Betigin KENDISI duruyor ve saglam (her cihazdan once systemd yanit suresini
# olcer, /proc/stat kullanir, 10sn araliklarla acar) -> DOGRUDAN cagiriliyor.
if [ -x /opt/fleet-agent/wd-kademeli.sh ]; then
  timeout 3600 /opt/fleet-agent/wd-kademeli.sh >/dev/null 2>&1 || true
else
  say "UYARI: wd-kademeli.sh YOK -> acilmayan cihazlar tetiklenemedi"
fi
say "kademeli bitti: acik=$(acik)/$TOP"

# 3) ADB toplu baglanti (3 tur)
for tur in 1 2 3; do
  /opt/fleet-agent/wd-saglik.sh > /tmp/saglik.out 2>/dev/null
  grep -E "\|192\.168\.|\|10\.10\." /tmp/saglik.out | cut -d"|" -f2 \
    | xargs -P 30 -I{} timeout 8 adb connect {}:5555 >/dev/null 2>&1
  say "ADB tur$tur: $(adbn) bagli"
  [ "$(adbn)" -ge $(( TOP * 80 / 100 )) ] && break
  sleep 45
done

# 4) Agent + firtina nobeti
systemctl start fleet-agent
say "fleet-agent baslatildi"
for i in $(seq 1 10); do
  sleep 30
  W=$(_num "$(pgrep -fc wd-run.sh 2>/dev/null)")
  D=$(dst)
  if [ "$W" -gt 200 ] || [ "$D" -gt 80 ]; then
    systemctl stop fleet-agent
    say "!!! FIRTINA (wd-run=$W D=$D) -> agent DURDURULDU, el mudahalesi gerekli"
    tg_gonder "🚨 FIRTINA: wd-run=$W D=$D — fleet-agent DURDURULDU, EL MUDAHALESI GEREKLI. http://125.253.73.45/durum"
    exit 1
  fi
done
say "agent stabil: wd-run=$(_num "$(pgrep -fc wd-run.sh 2>/dev/null)") D=$(dst)"

# 5) Health-watch en son
systemctl start wd-health-watch.timer 2>/dev/null || systemctl start wd-health-watch 2>/dev/null
say "=== TAMAMLANDI: acik=$(acik)/$TOP adb=$(adbn) D=$(dst) ==="
tg_gonder "✅ Filo toparlandi: acik=$(acik)/$TOP  adb=$(adbn)  D=$(dst) — http://125.253.73.45/durum"
