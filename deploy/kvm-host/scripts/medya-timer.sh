#!/bin/bash
# Medya otomatik indirme SUPURGESI — systemd timer ile periyodik calisir.
# Yeni kurulan / yeni WhatsApp kaydi yapilan cihazlarda maske KAPALI baslar;
# bu supurge onlari yakalar. Zaten 15 olanlari ATLAR (ucuz okuma), yalnizca
# eksik olanlara dokunur. Mesgul cihazlar (ekranda sohbet/kayit) atlanir.
set -e

UNIT=/etc/systemd/system/wa-medya-supurge.service
TIMER=/etc/systemd/system/wa-medya-supurge.timer

cat > "$UNIT" <<'UEOF'
[Unit]
Description=WhatsApp medya otomatik indirme supurgesi (yeni cihazlari yakalar)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/fleet-agent/medya-ac-filo.sh
# Tek tur en fazla ~1 saat surebilir (151 cihaz x ~25sn en kotu durumda)
TimeoutStartSec=5400
Nice=10
UEOF

cat > "$TIMER" <<'TEOF'
[Unit]
Description=WhatsApp medya supurgesi - 6 saatte bir

[Timer]
# Ilk tur acilistan 20 dk sonra (boot firtinasina binmesin), sonra 6 saatte bir.
OnBootSec=20min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
TEOF

systemctl daemon-reload
systemctl enable --now wa-medya-supurge.timer >/dev/null 2>&1
echo "timer: $(systemctl is-active wa-medya-supurge.timer)"
systemctl list-timers wa-medya-supurge.timer --no-pager 2>/dev/null | head -3
