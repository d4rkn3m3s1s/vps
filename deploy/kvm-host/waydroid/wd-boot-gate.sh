#!/bin/bash
# Boot kapisi: kademeli gecikme + UCUZ yuk kapisi.
#
# ★★★ 2026-08-14 KOK SEBEP (3 kilit sonrasi bulundu):
#   Eski kapi her 12 sn'de `ps -eo stat | grep -c "^D"` calistiriyordu.
#   `ps -e` /proc altindaki TUM surecleri tarar (bu hostta on binlerce).
#   76 cihaz ayni anda beklerken = 76 es zamanli /proc taramasi
#   -> /proc kilitlenir -> systemd tikanir (o da /proc okur)
#   -> `systemctl` yanit vermez, SSH girisi (PAM->systemd) ACILMAZ.
#   KANIT: 22:22 sistem BOMBOS (D=2, load=33) iken 76 cihaz tetiklendi,
#          90 sn icinde SSH tamamen kilitlendi. Ucuncu kez ayni sekilde.
#   Yani "yuk freni"nin KENDISI yuku yaratiyordu.
#
#   FIX: cekirdek bu sayiyi zaten tutuyor -> /proc/stat "procs_blocked".
#        Tek kucuk dosya okumasi, tarama YOK. Ayni bilgi, ~1000x ucuz.
#
# ELLE acilislarda /run/wd-nogate varsa gecikme atlanir; kapi yine calisir.
INST="$1"
[ -z "$INST" ] && exit 0

# D-state sayaci - UCUZ (cekirdek sayaci, /proc taramasi yok)
dblocked(){ awk '/^procs_blocked/{print $2; exit}' /proc/stat 2>/dev/null || echo 0; }

# ★★★2026-08-20 UYKU YALNIZCA REBOOT FIRTINASI PENCERESINDE.
# Kapinin amaci acilista 140 instance'in AYNI ANDA kalkmasini engellemek. Ama ayni
# kapi `wd-provision` -> `systemctl start waydroid@X` yolunda da calisiyordu; yani
# TEK bir yeni cihaz kurulumu bosuna 0-357 sn bekliyordu.
# CANLI KANIT (mi440): kurulum %8'de asili kaldi; surec agaci
#   wd-provision.sh mi440 -> systemctl start waydroid@mi440 -> wd-boot-gate.sh mi440
# ve mi440 dizini 64 KB'de SABITTI (hic is yapilmiyordu). 440 %% 52 = 24 -> 168 sn uyku.
# Operator gozlemi: "normalde 1.5 dk suruyordu".
# ⚠`/run/wd-nogate` bu gecikmeyi bastiriyordu; reboot guvenligi icin silindi
# (dogruydu) ve gecikme geri geldi. Kalici cozum: uptime penceresi.
# ★D-state kapisi (asagida) AYNEN KALIR — gercek yuk korumasi odur.
WD_GATE_BOOT_WINDOW_S="${WD_GATE_BOOT_WINDOW_S:-900}"
_up=$(cut -d. -f1 /proc/uptime 2>/dev/null || echo 999999)
case "$_up" in ''|*[!0-9]*) _up=999999 ;; esac
if [ ! -e /run/wd-nogate ] && [ "$_up" -lt "$WD_GATE_BOOT_WINDOW_S" ]; then
  n=$(echo "$INST" | grep -oE '[0-9]+' | head -1)
  n=${n:-0}
  # 52 dilim x 7sn = 0-357sn (~6dk). Ayni dilime en fazla 3 cihaz duser.
  sleep $(( (n % 52) * 7 + RANDOM % 7 ))
fi

# YUK KAPISI: sira gelse bile sistem zorlaniyorsa bekle (en fazla ~30 dk).
#
# ★ 2026-08-14 (v5b): LOAD KAPIDAN CIKARILDI.
#   Olcum: load=118.74 (esik 110) -> 37 cihaz BOSUNA bekliyordu, oysa ayni anda
#   D-state=0 ve CPU %60.4 BOSTA idi. Waydroid uyuyan threadleri load'a sayiyor
#   (156 cihaz ~ yuz binlerce thread), bu hostta load ANLAMSIZ bir esik.
#   Filo 88'de takilmasinin sebebi buydu. Artik tek olcut: procs_blocked.
for i in $(seq 1 150); do
  D=$(dblocked)
  [ "${D:-0}" -le 40 ] && break
  sleep 12
done
exit 0
