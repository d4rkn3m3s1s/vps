#!/bin/bash
# wd-provision.sh <instance> — phoenixNAP: izole instance init (GApps paylaşımlı).
# Agent PROVISION_DEVICE bunu çağırır, PROVISION_RESULT satırı bekler.
set -u
INSTANCE="${1:?instance name required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUBNET_ID="$(sh "$HERE/net-head.sh" "$INSTANCE")"
DEV_IP="192.168.$SUBNET_ID.112"
log(){ echo "[wd-provision:$INSTANCE] $*"; }
MI=/opt/waydroid-mi2

[ "$INSTANCE" = "default" ] && { log "FATAL: instance == default"; exit 1; }

# init (yoksa) — GApps imajını PAYLAŞ (-i), ayrı indirme yok
if [ ! -f "/var/lib/waydroid.$INSTANCE/waydroid.cfg" ]; then
  log "init (GApps paylaşımlı)…"
  PYTHONPATH="$MI" python3 "$MI/waydroid.py" --instance "$INSTANCE" init -f -i /var/lib/waydroid/images >/var/log/wd-$INSTANCE-init.log 2>&1
  [ -f "/var/lib/waydroid.$INSTANCE/waydroid.cfg" ] || { log "FATAL: init failed"; tail -5 /var/log/wd-$INSTANCE-init.log; exit 1; }
fi

# ★2026-07-30 BENZERSİZ MAC. Waydroid'in şablonu (/usr/lib/waydroid/data/configs/config_3)
# MAC'i SABİT yazıyor → canlı filoda 35 instance'ın 35'i de aynı MAC'e sahipti
# (00:16:3e:f9:d3:03, üstelik `00:16:3e` = Xen/LXC'nin bilinen OUI'si → hem "aynı makine"
# hem "sanal makine" izi). Şablonu rastgeleleştirmek TEK BAŞINA yetmez: iki instance aynı
# şablonu kopyalarsa yine çakışır. Bu yüzden init'ten HEMEN SONRA, cihaz henüz
# başlamamışken instance'a kendi MAC'ini yazıyoruz.
# Best-effort: betik yoksa/başarısızsa kurulum durmaz (MAC bir anti-detection
# iyileştirmesi, kurulumun ön koşulu değil).
if [ -x /usr/local/bin/wd-mac-unique.sh ]; then
  if /usr/local/bin/wd-mac-unique.sh set "$INSTANCE" >/tmp/wd-mac-$INSTANCE.log 2>&1; then
    log "benzersiz MAC atandı ($(grep -m1 -oE '([0-9a-f]{2}:){5}[0-9a-f]{2}' /tmp/wd-mac-$INSTANCE.log 2>/dev/null))"
  else
    log "UYARI: MAC atanamadı (kurulum devam ediyor) — $(tail -1 /tmp/wd-mac-$INSTANCE.log 2>/dev/null)"
  fi
else
  log "UYARI: wd-mac-unique.sh yok — instance PAYLAŞIMLI şablon MAC'i ile açılacak"
fi

# suspend_action=none — idle-freeze pm install'i yarida keser (kok neden). Kapat.
if grep -q "^suspend_action = freeze" "/var/lib/waydroid.$INSTANCE/waydroid.cfg" 2>/dev/null; then
  sed -i "s/^suspend_action = .*/suspend_action = none/" "/var/lib/waydroid.$INSTANCE/waydroid.cfg"
  log "suspend_action=none (idle-freeze kapatildi)"
fi
log "instance hazır subnet=$SUBNET_ID ip=$DEV_IP"
echo "PROVISION_RESULT subnet=$SUBNET_ID ip=$DEV_IP port=5555 instance=$INSTANCE"
