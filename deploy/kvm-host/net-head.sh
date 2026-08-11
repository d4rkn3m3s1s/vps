#!/bin/bash
# net-head.sh <instance> — çakışmasız sıralı subnet (2..239). Bash, flock ile atomik.
set -u
MAP=/var/lib/waydroid-subnets.map
INSTANCE="${1:-}"
[ -z "$INSTANCE" ] && { echo 240; exit 0; }
mkdir -p "$(dirname "$MAP")"; touch "$MAP"

# atomik lock (mkdir tabanlı, flock bağımsız)
LOCKD=/var/lib/waydroid-subnets.lock
i=0; while ! mkdir "$LOCKD" 2>/dev/null; do i=$((i+1)); [ $i -gt 50 ] && break; sleep 0.1; done
trap 'rmdir "$LOCKD" 2>/dev/null' EXIT

EXIST=$(awk -v n="$INSTANCE" '$1==n{print $2; exit}' "$MAP")
if [ -n "$EXIST" ]; then
  # ★2026-08-04 MUKERRER-KORUMASI BURADA DA GEREKLI. 30 Tem'de eklenen koruma
  # (asagida, satir ~31) YALNIZCA yeni subnet atanan yolda calisiyordu; instance
  # haritada ZATEN varsa akis burada erken cikiyor ve mukerrer satir HIC
  # temizlenmiyordu. CANLI OLARAK YASANDI (mi19): haritada "mi19 63" IKI KEZ
  # vardi, `awk '$2==s'` taramasi subnet 63'u dolu sayiyordu ve `grep -w mi19 |
  # awk '{print $2}'` okuyan betikler IKI DEGER birden aliyordu.
  # Bu instance'in FAZLA satirlarini birak-ilkini-tut mantigiyla temizle.
  if [ "$(grep -cE "^${INSTANCE} " "$MAP" 2>/dev/null)" -gt 1 ]; then
    awk -v n="$INSTANCE" '$1==n{if(seen++)next} {print}' "$MAP" > "$MAP.tmp" 2>/dev/null \
      && mv "$MAP.tmp" "$MAP"
  fi
  echo "$EXIST"; exit 0
fi

# ★2026-08-12 CAKISMA KOKU: burasi bos subnet'i YALNIZCA haritaya bakarak seciyordu.
# Harita ile GERCEK durum kayabiliyor (asagidaki canli ornek), ve kaydigi anda
# haritada "bos" gorunen bir subnet sahada DOLU olabiliyor:
#     mi197: harita=74  ama canli=125
#     mi198: harita=125 ama canli=127
#     mi201: harita=127 ama canli=130
#     mi240: haritada YOK,      canli=130  ← mi201 ile CAKISTI
# Sonuc: yeni instance IP aliyor ama yonlendirme bozuluyor; `adb connect` "No route
# to host" veriyor ve kurulum "Cihaz acilisi bekleniyor" adiminda sonsuza kadar
# takiliyor (panel "eth0 IPv4 gecikti — DHCP" der, DHCP SUCSUZDUR).
# FIX: haritaya ek olarak CANLI bridge'leri de tara. Iki kaynaktan biri bile o
# subnet'i kullaniyorsa atla. Boylece harita bozulsa/kaysa bile cakisma URETILEMEZ.
# Not: `ip -br addr` kullanilmiyor — bu betik `sh` ile de calisabiliyor ve bazi
# ortamlarda `-br` yok; `ip -o -4 addr` her yerde var.
subnet_live_used() {
  ip -o -4 addr show 2>/dev/null | grep -qE "[[:space:]]192\.168\.$1\.1/(24|[0-9]+)([[:space:]]|$)"
}

S=2
while [ "$S" -le 239 ]; do
  if awk -v s="$S" '$2==s{f=1} END{exit !f}' "$MAP"; then S=$((S+1)); continue; fi
  if subnet_live_used "$S"; then
    # Haritada bos ama sahada dolu: harita kaymis demektir. Atla ve NOT dus —
    # sessizce gecmek, kokeni gorunmez kilan seyin ta kendisiydi.
    echo "net-head: subnet $S haritada bos ama CANLI bridge'de dolu — atlandi" >&2
    S=$((S+1)); continue
  fi
  break
done
[ "$S" -gt 239 ] && { echo "240"; exit 0; }
# 2026-07-30 MUKERRER-KORUMASI. Yazmadan ONCE bu instance'in TUM eski satirlarini sil.
# CANLI OLARAK YASANDI (mi46): haritada iki satir olustu ("mi46 47" + "mi46 31" — ikincisi
# cihaz silinip yeniden kurulmasindan kalan bayat kayit). health-watch subnet'i
# `grep -w mi46 | awk '{print $2}'` ile okudugu icin IKI DEGERI birden aliyor
# ("47\n31"), beklenen adres "192.168.47\n31.112" gibi bozuk cikiyor, cihaz ADB'den
# bulunamiyor ve HER TURDA "zombie" sanilip gereksiz yeniden baslatiliyordu.
# Yukaridaki EXIST kontrolu normal akista yeterli, ama BASKA betikler de (wd-run.sh,
# wd-destroy.sh) bu haritaya dokunuyor; burada tek-satir garantisi veriyoruz.
if grep -qE "^${INSTANCE} " "$MAP" 2>/dev/null; then
  grep -vE "^${INSTANCE} " "$MAP" > "$MAP.tmp" 2>/dev/null && mv "$MAP.tmp" "$MAP"
fi
printf '%s %s\n' "$INSTANCE" "$S" >> "$MAP"
echo "$S"
