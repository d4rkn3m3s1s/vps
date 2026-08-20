#!/bin/bash
# Instance listesini KALICI yere yazar (/tmp reboot'ta silinir).
#
# ★2026-08-15: HARIC TUTMA listesi eklendi. /var/lib/waydroid.* altinda filoya
# ait OLMAYAN dizinler de bulunabiliyor (ornek: `work` -- gercek instance yapisi
# var ama DB'de karsiligi YOK).
#
# ★★★2026-08-20 KOK DUZELTME — LISTE ARTIK "DIZIN VAR MI" DEGIL.
# Eski surum ham `/var/lib/waydroid.*` dizinlerini sayiyordu. Ama bir cihaz
# SILININCE dizini GERIDE KALIYOR -> liste sisiyor. Canli olcum (20 Agu):
#   dizin=158  ama  enabled=141  running=141  adb=141
# Kalan 17'sinin (mi9 mi13 mi16 mi17 mi18 mi23 mi27 mi29 mi185 mi414 mi415
# mi435 mi437 mi438 mi439 mi441 mi442) systemd birimi bile YOKTU = silinmisler.
# Uc ayri zarar veriyordu:
#   1) /durum "141/158" gosterip SUREKLI turuncu "bazi cihazlar dusuk" uyarisi
#      veriyordu — filo eksiksizken operator her bakista sorun sandi,
#   2) silinmis 17 cihaz "Sorunlu cihazlar" listesinde sonsuza dek durdu,
#   3) wd-saglik.sh her turda onlari da tarayip 17 bosuna lxc-attach zaman
#      asimi yedi (tur suresi uzadi).
#
# YENI KURAL — bir instance filoya AITTIR eger:
#   (a) systemd'de ENABLED ise -> "calismasi GEREKEN" cihaz. Dusuk olsa bile
#       sayilir; boylece gercek arizalar payda'da gorunmeye devam eder.
#   (b) VEYA su an konteyneri AYAKTA ise (bridge'inin uye arayuzu var) -> yeni
#       kurulan, henuz `systemctl enable` edilmemis cihaz gozden KACMASIN.
# Birlesim: silinen DUSER, dusmus-ama-kayitli KALIR, yeni kurulan GIRER.
STATE=/opt/fleet-agent/state
HARIC="$STATE/instance-haric.txt"
TMP="$STATE/all_inst.txt.tmp"

{
  # (a) systemd'de enabled olan birimler
  ls /etc/systemd/system/multi-user.target.wants/ 2>/dev/null \
    | sed -n 's/^waydroid@\(.*\)\.service$/\1/p'
  # (b) konteyneri su an ayakta olanlar (bridge uye arayuzu VAR)
  for d in /sys/class/net/waydroid-*/brif; do
    [ -n "$(ls -A "$d" 2>/dev/null)" ] || continue
    d=${d#/sys/class/net/waydroid-}
    echo "${d%/brif}"
  done
} 2>/dev/null \
  | sed '/^$/d' \
  | { if [ -s "$HARIC" ]; then grep -vxF -f <(sed '/^$/d' "$HARIC") || true; else cat; fi; } \
  | sort -u > "$TMP"

# ★GUVENLIK: liste BOSALIRSA eskisini KORU. systemd veya sysfs bir an cevap
# vermezse liste sifirlanir, /durum ve wd-saglik.sh tamamen kor kalirdi.
if [ -s "$TMP" ]; then
  mv "$TMP" "$STATE/all_inst.txt"
else
  rm -f "$TMP" 2>/dev/null || true
fi

# Silinmis cihazlardan kalan ARTIK dizinleri ayri bir dosyaya yaz: sayimlara
# KARISMAZ ama /durum'da bilgi olarak gosterilir (disk temizligi icin gorunur
# kalsin -- sessizce buyumesinler).
ls -d /var/lib/waydroid.*/ 2>/dev/null \
  | sed 's#.*/waydroid\.##;s#/##' \
  | sed '/^$/d' \
  | { if [ -s "$HARIC" ]; then grep -vxF -f <(sed '/^$/d' "$HARIC") || true; else cat; fi; } \
  | sort -u \
  | { if [ -s "$STATE/all_inst.txt" ]; then grep -vxF -f "$STATE/all_inst.txt" || true; else cat; fi; } \
  > "$STATE/artik_inst.txt" 2>/dev/null || true

ln -sf "$STATE/all_inst.txt" /tmp/all_inst.txt
