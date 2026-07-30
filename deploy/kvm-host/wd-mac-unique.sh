#!/bin/bash
# wd-mac-unique.sh — her Waydroid instance'ına BENZERSİZ ve gerçekçi bir MAC adresi ver.
#
# ★2026-07-30 KÖK NEDEN: Waydroid'in kendi şablonları
#   /usr/lib/waydroid/data/configs/config_1  (lxc.network.hwaddr)
#   /usr/lib/waydroid/data/configs/config_3  (lxc.net.0.hwaddr)
# MAC'i SABİT yazıyor: 00:16:3e:f9:d3:03. Her yeni instance bu şablonu kopyaladığı için
# canlı filoda 35 instance'ın 35'i de AYNI MAC'e sahipti (ölçüldü, 30 Tem). Dahası
# `00:16:3e` Xen/LXC'nin bilinen OUI'si — yani MAC hem "bunlar aynı makine" diyor hem
# "bu bir sanal makine" diyor. Anti-detection açısından iki kat kötü.
#
# ⚠️ MAC KONTEYNER İÇİNDEN DEĞİŞTİRİLEMEZ (canlı test edildi): `ip link set eth0 address`
# kernel tarafından reddediliyor, üstelik `link down` çalıştığı için cihazın ağını
# koparıyor. MAC yalnızca LXC config'inde, instance DURURKEN değiştirilebilir.
#
# Kullanım:
#   wd-mac-unique.sh template            # şablonları rastgeleleştir (yeni instance'lar için)
#   wd-mac-unique.sh set <inst>          # tek instance'a yeni MAC yaz (instance DURMALI)
#   wd-mac-unique.sh show                # tüm instance'ların MAC'lerini listele
#   wd-mac-unique.sh fix-all             # MAC'i şablonla aynı olan HER instance'a yeni MAC
#
# Not: `set`/`fix-all` config'i yazar; MAC yalnızca instance yeniden BAŞLADIĞINDA geçerli
# olur. Çalışan bir instance'ı bu betik DURDURMAZ — kesinti kararı çağıranın işidir.
set -uo pipefail

CFG_DIRS_GLOB='/var/lib/waydroid.*'
TPL_1='/usr/lib/waydroid/data/configs/config_1'
TPL_3='/usr/lib/waydroid/data/configs/config_3'
# Şablonda hâlihazırda duran (ve fabrikadan gelen) MAC — "henüz kişiselleştirilmemiş"
# işareti olarak bunu arıyoruz.
STOCK_MAC='00:16:3e:f9:d3:03'

# Gerçek telefon/ağ üreticilerinin OUI'leri. Amaç `00:16:3e` (Xen/LXC) izini bırakmamak:
# bir uygulama MAC'in ilk 3 oktetine bakarsa gerçek bir cihaz görsün.
OUIS=(
  '3c:5a:b4'  # Google
  'e8:50:8b'  # Samsung
  '5c:51:88'  # Motorola
  'ac:37:43'  # HTC
  '9c:b6:d0'  # Realtek (yaygın Wi-Fi yongası)
  '40:4e:36'  # HTC
  '18:f0:e4'  # Xiaomi
  '64:b4:73'  # Xiaomi
  'd0:17:c2'  # ASUS
  '54:bd:79'  # Samsung
)

rand_mac() {
  local oui="${OUIS[$((RANDOM % ${#OUIS[@]}))]}"
  # Son 3 okteti rastgele üret. /dev/urandom kullanıyoruz: $RANDOM 15 bitlik ve
  # aynı saniyede çağrılan iki instance aynı tohumdan aynı değeri üretebilir.
  local tail
  tail=$(od -An -tx1 -N3 /dev/urandom | tr -d ' \n' | sed 's/\(..\)\(..\)\(..\)/\1:\2:\3/')
  printf '%s:%s\n' "$oui" "$tail"
}

# Bir instance'ın config dosyasını bul (config_3 formatı = lxc.net.0.hwaddr).
cfg_of() { echo "/var/lib/waydroid.$1/lxc/waydroid/config"; }

mac_of() {
  local f; f=$(cfg_of "$1")
  [ -f "$f" ] || { echo '-'; return; }
  grep -m1 -oE '^lxc\.net\.0\.hwaddr[[:space:]]*=[[:space:]]*\S+' "$f" 2>/dev/null \
    | awk '{print $NF}' || echo '-'
}

# ★2026-07-30 DHCP LEASE'İ DE GÜNCELLE — yoksa cihaz YANLIŞ IP alır.
#
# CANLI OLARAK YAŞANDI (mi46/wa-b0uq): sabit `.112` adresi dnsmasq lease dosyasında
# MAC'e KİLİTLİ tutuluyor:
#   /var/lib/misc/dnsmasq.waydroid-<inst>.leases
#   4102444800 00:16:3e:f9:d3:03 192.168.47.112 Pixel-8-Pro 01:00:16:3e:f9:d3:03
# MAC değişince lease eşleşmiyor → dnsmasq havuzdan RASTGELE adres veriyor
# (gözlenen: .183 yerine .112) → agent/ADB `.112`yi arıyor, cihaz "Durduruldu"
# görünüyor ve health-watch "runtime temizle+yeniden başlat" reçetesiyle sonsuz
# döngüye giriyor (5 tur boşa denedi) çünkü sorun runtime değil ADRESLEME.
#
# Bu yüzden MAC yazan her yol lease'i de aynı MAC'le yeniden yazmalı. Satır formatı:
#   <expiry> <mac> <ip> <hostname> <client-id>
# client-id, MAC'in `01:` önekli hâli (RFC 2132 tipi-1 donanım adresi).
fix_lease() { # inst mac
  local inst="$1" mac="$2"
  local lf="/var/lib/misc/dnsmasq.waydroid-$inst.leases"
  [ -f "$lf" ] || return 0   # lease yoksa yapacak bir şey yok (ilk boot'ta oluşur)
  [ -f "$lf.bak-mac" ] || cp -a "$lf" "$lf.bak-mac"
  # Mevcut satırdaki IP + hostname'i KORU, yalnızca MAC ve client-id'yi değiştir.
  awk -v m="$mac" '{
    if (NF >= 3) { $2 = m; if (NF >= 5) $5 = "01:" m; print }
    else print
  }' "$lf" > "$lf.tmp" && mv "$lf.tmp" "$lf"
  if grep -qF "$mac" "$lf"; then echo "      ↳ lease güncellendi ($lf)"; else echo "      ↳ UYARI: lease güncellenemedi"; fi
}

set_mac() { # inst mac
  local inst="$1" mac="$2" f; f=$(cfg_of "$inst")
  [ -f "$f" ] || { echo "  ✗ $inst: config yok ($f)"; return 1; }
  # Yedek bir kez alınır (ilk çalıştırmada), sonraki çağrılar ezmez.
  [ -f "$f.bak-mac" ] || cp -a "$f" "$f.bak-mac"
  if grep -q '^lxc\.net\.0\.hwaddr' "$f"; then
    sed -i "s|^lxc\.net\.0\.hwaddr.*|lxc.net.0.hwaddr = $mac|" "$f"
  else
    # hwaddr satırı yoksa lxc.net.0.name'in ardına ekle (sıra LXC için önemsiz ama
    # okunabilirlik açısından ağ bloğunda kalsın).
    sed -i "/^lxc\.net\.0\.name/a lxc.net.0.hwaddr = $mac" "$f"
  fi
  local now; now=$(mac_of "$inst")
  if [ "$now" = "$mac" ]; then
    echo "  ✓ $inst -> $mac"
    fix_lease "$inst" "$mac"
    return 0
  fi
  echo "  ✗ $inst: yazılamadı (şimdi: $now)"; return 1
}

case "${1:-show}" in
  template)
    # Yeni instance'lar fabrika MAC'ini KOPYALAMASIN: şablondaki sabit satırı her
    # çağrıda yeni bir rastgele MAC'le değiştir. Bu tek başına yeterli DEĞİL (aynı
    # şablonu iki instance aynı anda kopyalarsa yine çakışır) — bu yüzden tek-tık
    # kurulum akışı instance oluşturduktan SONRA `set <inst>` de çağırmalı.
    for t in "$TPL_1" "$TPL_3"; do
      [ -f "$t" ] || continue
      [ -f "$t.bak-mac" ] || cp -a "$t" "$t.bak-mac"
      m=$(rand_mac)
      # ⚠️ `-E` ŞART: temel (BRE) sözdizimindeki `\(a\|b\)` alternasyonu bu sed'de
      # çalışmıyor (canlı test: desen hiç eşleşmedi ama sed 0 döndü → betik "✓" dedi,
      # dosya DEĞİŞMEDİ). config_1 `lxc.network.hwaddr`, config_3 `lxc.net.0.hwaddr`
      # kullanıyor; ikisini tek desenle yakalamak için genişletilmiş regex gerekiyor.
      sed -i -E "s/^(lxc\.net(work|\.0)\.hwaddr[[:space:]]*=[[:space:]]*).*/\1$m/" "$t"
      # Yazımı DOĞRULA — sed'in sessiz başarısızlığı bir daha "başarılı" görünmesin.
      if grep -qF "$m" "$t"; then echo "  ✓ şablon $t -> $m"; else echo "  ✗ şablon $t: YAZILAMADI"; fi
    done
    ;;
  set)
    inst="${2:?kullanim: wd-mac-unique.sh set <instance>}"
    set_mac "$inst" "$(rand_mac)"
    ;;
  show)
    printf '%-10s %-20s %s\n' 'INSTANCE' 'CONFIG-MAC' 'DURUM'
    for d in $CFG_DIRS_GLOB; do
      [ -d "$d" ] || continue
      inst="${d##*waydroid.}"
      m=$(mac_of "$inst")
      st='özel'
      [ "$m" = "$STOCK_MAC" ] && st='!! FABRİKA (paylaşımlı)'
      [ "$m" = '-' ] && st='config yok'
      printf '%-10s %-20s %s\n' "$inst" "$m" "$st"
    done
    ;;
  fix-all)
    # Fabrika MAC'ini taşıyan HER instance'a benzersiz bir MAC yaz. Çakışma
    # olmadığından emin olmak için verilen MAC'leri bir sette topluyoruz.
    declare -A used=()
    for d in $CFG_DIRS_GLOB; do
      [ -d "$d" ] || continue
      inst="${d##*waydroid.}"
      cur=$(mac_of "$inst")
      [ "$cur" = '-' ] && continue
      if [ "$cur" != "$STOCK_MAC" ]; then used["$cur"]=1; fi
    done
    n=0
    for d in $CFG_DIRS_GLOB; do
      [ -d "$d" ] || continue
      inst="${d##*waydroid.}"
      cur=$(mac_of "$inst")
      [ "$cur" = "$STOCK_MAC" ] || continue
      # Kullanılmamış bir MAC bul (en fazla 20 deneme; çakışma olasılığı ~0).
      for _ in $(seq 20); do
        m=$(rand_mac); [ -z "${used[$m]:-}" ] && break
      done
      used["$m"]=1
      set_mac "$inst" "$m" && n=$((n+1))
    done
    echo "  → $n instance'a benzersiz MAC yazıldı (yeniden başlatılınca geçerli olur)"
    ;;
  *)
    echo "kullanim: $0 {template|set <inst>|show|fix-all}" >&2
    exit 2
    ;;
esac
