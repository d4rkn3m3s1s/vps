#!/bin/bash
# ============================================================================
# FLEET UDP GUARD — cihazlarin QUIC (UDP/443) ile proxy'yi ATLAMASINI engeller
# ============================================================================
# ★★★2026-08-25 KOK BULGU: WhatsApp cihazlari Meta sunucularina (57.144.0.0/14)
# UDP/443 = QUIC ile baglaniyordu. Bu trafik redsocks'a UGRAMIYOR (redsocks yalniz
# TCP proxy'ler) ve host'un FIZIKSEL arayuzunden (bond0.3) cikiyordu:
#     IN=waydroid-mi413  OUT=bond0.3  SRC=192.168.93.23  DST=57.144.134.145  DPT=443
# Yani cihaz, proxy IP'si yerine SUNUCUNUN DATACENTER IP'siyle WhatsApp'a
# baglaniyordu = dogrudan ban vektoru. TCP tabanli sizinti taramalari (curl ile
# cikis IP olcumu) bunu ASLA goremez, cunku o olcum TCP'den gider ve DOGRU
# cikar. 45 saniyelik ornekte 59 paket loglandi, ilk turda 272 paket / 301 KB.
#
# ★TASARIM — gecmiste iki kez isirdi, ikisinden de kacinildi:
#   1) CIHAZ BASINA kural KOYMA. 22 Agu'de 141 cihaz icin FORWARD basina kural
#      konuldu -> zincir 312 kurala cikti, ufw 170. siraya dustu, DHCP zamanlamasi
#      bozuldu ve cihaz kurulumu 90sn -> 412sn olup 3 GUN yeni cihaz actirmadi.
#      Burada TEK kural var (O(1)) ve `192.168.0.0/16` tum filoyu kapsar; yeni
#      cihaz eklendiginde HICBIR SEY yapmak gerekmez.
#   2) YANLIS BACKEND. Bu hostta hem iptables-legacy hem nft tablolari var.
#      Waydroid kendi ACCEPT kurallarini LEGACY'ye yazar (`-A FORWARD -i
#      waydroid-miXXX -j ACCEPT`, 288 kural, sayaci aktif). nft tarafina yazilan
#      FORWARD kurallari HIC DEGERLENDIRILMEZ — 24 Tem ve 22 Agu'de kurulan 146
#      DROP kuralinin sayaci tam da bu yuzden 0'di. ★`iptables-legacy` ZORUNLU.
#
# ★MUAFIYETLER (sirasi onemli, DROP'tan ONCE gelmeli):
#   53  DNS   — cozumleme olmadan cihaz internetsiz kalir
#   67/68 DHCP — adres alamayan cihaz .112 statigine duser (bkz. 13 Agu notu)
#   123 NTP   — saat kayarsa WhatsApp oturumu bozulur, mesaj damgalari sasar
#
# ★REJECT (DROP degil): sessiz DROP'ta uygulama QUIC denemesini TIMEOUT'a kadar
# bekler ve gonderim yavaslar. `icmp-port-unreachable` ile uygulama ANINDA
# TCP'ye duser — TCP zaten redsocks uzerinden DOGRU proxy IP'sinden cikar.
# ============================================================================
set -u
# TAM YOL: systemd ortaminda PATH dar olabilir. `command -v iptables-legacy`
# bulamayip `exit 0` ile SESSIZCE cikarsa servis "basarili" gorunur ama koruma
# HIC kurulmaz. (Ayni tuzak: container icinde /system/bin PATH'te olmadigi icin
# `ip` cagrilari sessizce dusuyordu — 28 Tem.)
IPT=/usr/sbin/iptables-legacy
[ -x "$IPT" ] || IPT=$(command -v iptables-legacy 2>/dev/null || true)
CHAIN=FLEET-UDP
SRC=192.168.0.0/16

if [ -z "${IPT:-}" ] || [ ! -x "$IPT" ]; then
  echo "HATA: iptables-legacy bulunamadi — QUIC korumasi KURULAMADI" >&2
  exit 1   # exit 0 DEGIL: sessiz basarisizlik servisi "basarili" gosterir
fi

# Zinciri (yeniden) kur — idempotent
"$IPT" -N "$CHAIN" 2>/dev/null || true
"$IPT" -F "$CHAIN"
"$IPT" -A "$CHAIN" -p udp --dport 53  -j RETURN
"$IPT" -A "$CHAIN" -p udp --dport 67  -j RETURN
"$IPT" -A "$CHAIN" -p udp --dport 68  -j RETURN
"$IPT" -A "$CHAIN" -p udp --dport 123 -j RETURN
"$IPT" -A "$CHAIN" -p udp -j REJECT --reject-with icmp-port-unreachable
"$IPT" -A "$CHAIN" -j DROP

# Giris noktasi: TEK kural, FORWARD'in BASINDA. Once sil (cift kayit olmasin),
# sonra ekle — servis yeniden calistirilirsa kural birikmesin.
while "$IPT" -D FORWARD -s "$SRC" -p udp -j "$CHAIN" 2>/dev/null; do :; done
"$IPT" -I FORWARD 1 -s "$SRC" -p udp -j "$CHAIN"

# ★SONUCU DOGRULA: "calistim" demek yetmez, kuralin GERCEKTEN yerinde
# oldugunu kanitla ve degilse HATA don (yoksa servis basarili gorunur).
N=$("$IPT" -S FORWARD 2>/dev/null | grep -c -- "-j $CHAIN")
C=$("$IPT" -S "$CHAIN" 2>/dev/null | wc -l)
echo "FLEET-UDP kuruldu — giris kurali=$N (1 olmali), zincir=$C kural, FORWARD toplam=$("$IPT" -S FORWARD | wc -l)"
if [ "$N" != "1" ] || [ "$C" -lt 6 ]; then
  echo "HATA: koruma dogrulanamadi (giris=$N zincir=$C)" >&2
  exit 1
fi
