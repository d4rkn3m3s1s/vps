#!/bin/bash
# Instance listesini KALICI yere yazar (/tmp reboot'ta silinir).
#
# ★2026-08-15: HARIC TUTMA listesi eklendi. /var/lib/waydroid.* altinda filoya
# ait OLMAYAN dizinler de bulunabiliyor (ornek: `work` -- gercek instance yapisi
# var ama DB'de karsiligi YOK). Bunlar:
#   - sayimlari bozuyordu (panel 156 derken DB'de 155 cihaz vardi)
#   - "sorunlu cihaz" listesinde surekli gorunuyordu
#   - systemd'ye kaydedilince her boot'ta bosuna acilmaya calisiliyordu
# Haric listesi: /opt/fleet-agent/state/instance-haric.txt (satir basina bir ad)
STATE=/opt/fleet-agent/state
HARIC="$STATE/instance-haric.txt"

ls -d /var/lib/waydroid.*/ 2>/dev/null \
  | sed "s#.*/waydroid\.##;s#/##" \
  | { if [ -r "$HARIC" ]; then grep -vxF -f "$HARIC"; else cat; fi; } \
  | sort > "$STATE/all_inst.txt"

ln -sf "$STATE/all_inst.txt" /tmp/all_inst.txt
