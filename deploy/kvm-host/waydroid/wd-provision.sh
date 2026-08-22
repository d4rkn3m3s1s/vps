#!/bin/bash
# wd-provision.sh <instance> — phoenixNAP: izole instance init (GApps paylaşımlı).
# Agent PROVISION_DEVICE bunu çağırır, PROVISION_RESULT satırı bekler.
set -u
INSTANCE="${1:?instance name required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUBNET_ID="$(sh "$HERE/net-head.sh" "$INSTANCE")"

# ★★★2026-08-22 KURULUM SIZINTI PENCERESI KAPATILDI (FAIL-CLOSED).
# ONCEDEN: asagida `systemctl start waydroid@<inst>` konteyneri ACIYOR ve cihaz
# ANINDA aga cikabiliyor; proxy (redsocks + nat REDIRECT) ise DAHA SONRA, ayri bir
# adimda uygulaniyor. O aradaki saniyelerde cihaz trafigi host NAT'indan cikiyordu =
# DATACENTER IP SIZINTISI. Toplu kurulumda bu pencere cihaz sayisi kadar tekrarlanir.
# CANLI KANIT (22 Agu 01:43): operator tek bir test cihazi kurdu, /durum ANINDA
# "⚠ PROXY SIZINTISI — ban riski · sizinti 1" gosterdi; proxy uygulaninca 01:44'te
# 0'a dondu.
# COZUM: subnet belli olur olmaz, konteyner ACILMADAN once FAIL-CLOSED kural koy.
# Cihaz REDIRECT gelene kadar internetsiz kalir (zararsiz) ama SIZMAZ.
# ⚠️BASA eklenir (-I FORWARD 1): ufw-before-forward trafigi ACCEPT edip zinciri
#   sonlandirdigi icin sona eklenen kural hic gorulmez.
# ⚠️Mesru trafigi ETKILEMEZ: PREROUTING REDIRECT paketi yonlendirmeden ONCE yerele
#   cevirir, cihaz TCP'si FORWARD'a hic ugramaz (mi98'de bos-zincir sayaciyla olculdu).
# wd-destroy silmede bu kurali temizler; wd-proxy.sh her uygulamada idempotent kurar.
if [ "$(id -u)" = "0" ] && [ -n "${SUBNET_ID:-}" ]; then
  case "$SUBNET_ID" in
    ''|*[!0-9]*) : ;;
    *) if [ "$SUBNET_ID" -ge 1 ] && [ "$SUBNET_ID" -le 254 ]; then
         _KSNET="192.168.$SUBNET_ID.0/24"
         iptables -C FORWARD -s "$_KSNET" -p tcp -j DROP 2>/dev/null \
           || iptables -I FORWARD 1 -s "$_KSNET" -p tcp -j DROP 2>/dev/null \
           && log "kill-switch kuruldu ($_KSNET) — proxy gelene kadar SIZMAZ"
       fi ;;
  esac
fi
DEV_IP="192.168.$SUBNET_ID.112"
log(){ echo "[wd-provision:$INSTANCE] $*"; }
MI=/opt/waydroid-mi2

[ "$INSTANCE" = "default" ] && { log "FATAL: instance == default"; exit 1; }

# ★2026-08-04 İMAJ İNDİRME KÖKTEN KALDIRILDI (canlı arıza: kurulumlar 5-10 dk sürüp
# zaman aşımına düşüyordu — mi103/104/106..110 kayboldu).
#
# KÖK NEDEN: `-i /var/lib/waydroid/images` verilse bile waydroid.py o yolu "yerel imaj"
# SAYMIYORDU. initializer.py'nin kararı ŞU listeye bakıyor:
#     preinstalled_images_paths = ["/etc/waydroid-extra/images",
#                                  "/usr/share/waydroid-extra/images"]
#     if args.images_path not in preinstalled_images_paths: helpers.images.get(args)  # ← İNDİR
# Yolumuz listede olmadığı için HER kurulum system.zip (905MB) + vendor.zip (148MB)
# indiriyordu. Aylardır böyleydi; ağ hızlıyken (2-11 MB/s) fark edilmedi, hız 64 kB/s'ye
# düşünce kurulumlar toptan yandı. (`-f` suçlu DEĞİL — o yalnızca "zaten init edilmiş"
# kontrolünü atlar, indirme kararını etkilemez.)
#
# ÇÖZÜM: imajları listedeki yola BAĞLA. `os.path.isfile()` symlink'i takip eder, bu
# yüzden kopya değil symlink yeter (2.4GB disk tasarrufu). ÖLÇÜM: init 5-10 dk → 1 sn,
# sıfır indirme, cihaz 65 sn'de boot_completed=1.
PREINST=/usr/share/waydroid-extra/images
if [ ! -f "$PREINST/system.img" ] || [ ! -f "$PREINST/vendor.img" ]; then
  mkdir -p "$PREINST"
  ln -sf /var/lib/waydroid/images/system.img "$PREINST/system.img" 2>/dev/null || true
  ln -sf /var/lib/waydroid/images/vendor.img "$PREINST/vendor.img" 2>/dev/null || true
  log "preinstalled imaj bağlantısı kuruldu ($PREINST) — indirme devre dışı"
fi

# init (yoksa) — imajlar PREINST'ten paylaşılır, indirme YOK
if [ ! -f "/var/lib/waydroid.$INSTANCE/waydroid.cfg" ]; then
  log "init (paylaşımlı imaj, indirme yok)…"
  PYTHONPATH="$MI" python3 "$MI/waydroid.py" --instance "$INSTANCE" init -f -i "$PREINST" >/var/log/wd-$INSTANCE-init.log 2>&1
  # İndirme yapıldıysa preinstalled tespiti tutmamış demektir — sessizce yavaşlamak
  # yerine görünür kıl (bu satır logda çıkarsa PREINST bozulmuştur).
  if grep -q 'Downloading' "/var/log/wd-$INSTANCE-init.log" 2>/dev/null; then
    log "UYARI: init imaj İNDİRDİ — $PREINST bozuk olabilir (kurulum yavaşlar)"
  fi
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
# ★2026-08-15: REBOOT-KALICILIGI. Bu satir olmadan cihaz yalnizca kuruldugu
# oturumda yasar; sunucu yeniden baslayinca systemd onu HIC baslatmaz.
# (14 Agu: 126 cihaz reboot sonrasi bu yuzden acilmadi.)
if systemctl enable "waydroid@$INSTANCE" >/dev/null 2>&1; then
  log "systemd kaydi yapildi (reboot'ta otomatik acilir)"
else
  log "UYARI: systemctl enable BASARISIZ — bu cihaz reboot sonrasi ACILMAZ, elle enable edilmeli"
fi

# ★★★2026-08-18 GOZETIM systemd'YE DEVREDILIR — `enable` TEK BASINA YETMEZ.
# `enable` yalnizca REBOOT icin kayit yapar; birim SIMDI `inactive/dead` kalir.
# Bu durumda gozcu (wd-run icinde) calisir AMA systemd onu SAHIPLENMEZ:
# gozcu "container oldu" deyip `exit 1` yapsa bile systemd GORMEZ ve
# `Restart=on-failure` DEVREYE GIRMEZ → otomatik kurtarma zinciri KOPUK kalir.
# ★OLCUM: 151 cihazin 48'i (hepsi yeni kurulanlar) bu bosluktaydi.
# `start` guvenli: container ZATEN calisiyor, wd-run'un "zaten calisiyor →
# GOZETIM devralindi" yolu onu YENIDEN KURMAZ, yalnizca gozetimi ustlenir
# (canli kanit mi366: ADB kopmadi, lxc sureci ayni kaldi).
if systemctl start "waydroid@$INSTANCE" >/dev/null 2>&1; then
  log "gozetim systemd'ye devredildi (container olurse ~70sn'de otomatik kalkar)"
else
  log "UYARI: systemctl start BASARISIZ — cihaz systemd gozetimi DISINDA, otomatik kurtarma calismaz"
fi

log "instance hazır subnet=$SUBNET_ID ip=$DEV_IP"
echo "PROVISION_RESULT subnet=$SUBNET_ID ip=$DEV_IP port=5555 instance=$INSTANCE"
