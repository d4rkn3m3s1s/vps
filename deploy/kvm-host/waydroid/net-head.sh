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

# ★★★2026-08-13 SUBNET TAVANI 238 -> 492 (operatör: "filo büyüyecek").
#
# Subnet numarası doğrudan IP'nin ÜÇÜNCÜ oktetine yazılıyor (wd-run.sh:78
# `GW="192.168.$SUBNET.1"; IP="192.168.$SUBNET.112"`), bu yüzden 2..239 aralığı
# 192.168.0.0/16 bloğunun kendisiyle sınırlıydı = en fazla 238 cihaz.
# ÖLÇÜM (13 Ağu): 145 kullanımda, 140 canlı cihaz → tavana 93 kalmıştı.
#
# GENİŞLETME: 240..493 aralığı ikinci bir /16 bloğuna (10.10.0.0/16) eşlenir:
#   S <= 239  ->  192.168.<S>.0/24        (mevcut davranış, DEĞİŞMEDİ)
#   S >= 240  ->  10.10.<S-239>.0/24      (10.10.1.0 … 10.10.254.0)
# Böylece eski 140 cihazın adresi AYNEN kalır — taşıma/yeniden kurulum GEREKMEZ.
#
# ★ÇAKIŞMA DENETİMİ (canlı, host'un tüm IPv4'leri okundu):
#   bond0.2 10.0.0.11/24 · bond0.3 125.253.73.45/31 · docker0 172.17.0.1/16
#   Yani 10.0.0.0/24 host'un kendi ağı — 10.10.0.0/16 ONA DOKUNMAZ (farklı /16).
#   Docker 172.17'de, çakışma yok. 10.10.x TAMAMEN BOŞ.
subnet_prefix() {
  if [ "$1" -le 239 ]; then echo "192.168.$1"; else echo "10.10.$(($1 - 239))"; fi
}

# subnet_live_used'ın ikinci-blok karşılığı: verilen S için GERÇEK ön eki tarar.
subnet_live_used_any() {
  _p=$(subnet_prefix "$1")
  ip -o -4 addr show 2>/dev/null | grep -qE "[[:space:]]${_p}\.1/(24|[0-9]+)([[:space:]]|$)"
}

S=2
S_MAX=493        # 2..239 (192.168.x) + 240..493 (10.10.1..254) = 492 subnet
while [ "$S" -le "$S_MAX" ]; do
  if awk -v s="$S" '$2==s{f=1} END{exit !f}' "$MAP"; then S=$((S+1)); continue; fi
  if subnet_live_used_any "$S"; then
    # Haritada bos ama sahada dolu: harita kaymis demektir. Atla ve NOT dus —
    # sessizce gecmek, kokeni gorunmez kilan seyin ta kendisiydi.
    echo "net-head: subnet $S ($(subnet_prefix "$S").0/24) haritada bos ama CANLI bridge'de dolu — atlandi" >&2
    S=$((S+1)); continue
  fi
  break
done
# Tavana gercekten dayandiysak 240 DONME — o artik GECERLI bir subnet (10.10.1.x).
# Bunun yerine acikca hata ver ki kurulum sessizce cakisan bir adrese kurulmasin.
if [ "$S" -gt "$S_MAX" ]; then
  echo "net-head: TUM SUBNETLER DOLU ($S_MAX) — yeni cihaz kurulamaz, once cihaz silin" >&2
  exit 1
fi
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
