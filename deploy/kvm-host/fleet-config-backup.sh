#!/usr/bin/env bash
# Fleet YAPILANDIRMA yedegi — haftalik. DB yedegi AYRI (pg-backup.sh, gunluk).
#
# NEDEN: 11 Eyl denetiminde gorULdu ki tam sistem yedegi 24 Agu'dan beri (19 gun)
# alinmiyordu; yalniz DB dump'i donuyordu. Sunucu coksa /opt/fleet-agent altindaki
# betikler, systemd birimleri ve /etc yapilandirmalari KAYBOLURDU — bunlarin bir
# kismi repoda bile yoktu (6 betik, 11 Eyl'de repoya alindi).
#
# KAPSAM (kucuk, hizli, sirlar DAHIL — bu yuzden chmod 600):
#   /opt/fleet-agent            betikler + state
#   /etc/systemd/system         fleet/wd/waydroid birimleri + drop-in'ler (sirlar burada)
#   /etc/needrestart/conf.d     toplu-restart korumasi (3 Eyl felaketinin panzehiri)
#   /etc/logrotate.d            log rotasyon kurallari
#   /etc/apt/apt.conf.d         otomatik guncelleme ayarlari
#   /etc/redsocks-inst-*.conf   proxy conf'lari (sessid'ler dahil)
#
# HARIC: yeniden INDIRILEBILIR binary'ler. Ilk deneme (11 Eyl) 1.4 GB cikti; sebep
# wa-media 937 MB + apks 504 MB + apk 136 MB + magisk 27 MB idi. Bunlar yedegin
# amaci degil; haric tutulunca arsiv ~10 MB'a iner.
#
# NOT: satir devami (ters bolu) BILEREK kullanilmadi — bu projede tirnakli heredoc
# ters boluyu yiyip komutu bozmustu (bkz. 4 Eyl wd-run.sh yamasi). Tek satir guvenli.
set -uo pipefail
DIR=/opt/backups
mkdir -p "$DIR"
TS=$(date +%Y%m%d-%H%M)
OUT="$DIR/fleet-config-$TS.tar.gz"

tar -czf "$OUT" --warning=no-file-changed --ignore-failed-read --exclude=/opt/fleet-agent/wa-media --exclude=/opt/fleet-agent/apks --exclude=/opt/fleet-agent/apk --exclude=/opt/fleet-agent/magisk /opt/fleet-agent /etc/systemd/system /etc/needrestart/conf.d /etc/logrotate.d /etc/apt/apt.conf.d /etc/redsocks-inst-*.conf 2>/dev/null

# tar, degisen dosya icin 1 doner; asil olcut dosyanin OLUSMASI ve BOS OLMAMASI.
if [ -s "$OUT" ] && tar -tzf "$OUT" >/dev/null 2>&1; then
  chmod 600 "$OUT"              # sir icerir (drop-in proxy.conf, agent.env)
  # Retention: son 8 yedek (~2 ay haftalik)
  ls -1t "$DIR"/fleet-config-*.tar.gz 2>/dev/null | tail -n +9 | xargs -r rm -f
  echo "$(date '+%F %T') OK $(du -h "$OUT" | cut -f1) $OUT"
else
  echo "$(date '+%F %T') YEDEK BOZUK/BOS"; rm -f "$OUT"; exit 1
fi
