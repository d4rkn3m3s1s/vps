#!/bin/bash
# ★★★2026-08-22 BOOT SIZINTI KILL-SWITCH — reboot penceresini kapatir.
#
# SORUN: iptables kurallari bu makinede KALICI DEGIL (iptables-persistent yok,
# /etc/iptables/rules.v4 yok). Her reboot'ta cihaz REDIRECT kurallari SIFIRLANIR.
# Zaman cizelgesi:
#   boot -> iptables BOS
#        -> cihazlar boot-gate ile 0-18 dk arasinda acilir (ag'a cikabilir durumda)
#        -> wd-proxy-restore boot+90sn'de baslar ve 142 cihazi ~9sn/cihaz ile tarar
#   ARADA: REDIRECT yok -> cihaz trafigi host NAT'indan cikar = DATACENTER IP SIZINTISI
# Bu, 21 Tem'de "ban salgini" olarak kayda gecen durumun ta kendisi.
#
# COZUM: cihazlar acilmadan ONCE her subnet icin FAIL-CLOSED DROP kurali kur.
# REDIRECT gelene kadar cihaz internetsiz kalir (zararsiz) ama SIZMAZ.
# wd-proxy-restore her cihaza REDIRECT'i kurunca trafik normale doner; kill-switch
# kurali kalir ve bundan sonraki her REDIRECT bosluginda da korur.
#
# ⚠️BASA EKLENIR (-I FORWARD 1): ufw-before-forward trafigi ACCEPT edip zinciri
#   sonlandiriyor; sona eklenen kural HIC gorulmez.
# ⚠️MESRU TRAFIGI ETKILEMEZ: PREROUTING REDIRECT paketi yonlendirmeden ONCE yerele
#   cevirdigi icin cihaz TCP'si FORWARD'a hic ugramaz (mi98'de bos-zincir sayaciyla
#   olculdu: 2 gercek HTTPS isteginden sonra sayac 0).
set -u
MAP=/var/lib/waydroid-subnets.map
IPT="$(command -v iptables 2>/dev/null || echo /usr/sbin/iptables)"
LOG=/var/log/wd-killswitch.log
say() { echo "$(date '+%F %T') $*" >> "$LOG"; }

[ -r "$MAP" ] || { say "subnet haritasi yok — atlandi"; exit 0; }
[ -x "$IPT" ] || { say "iptables bulunamadi — atlandi"; exit 0; }

eklendi=0; vardi=0; atlandi=0
# Haritadaki TUM subnetler (silinmis cihazlarinki de dahil — zararsiz, cihaz yoksa
# o subnetten paket gelmez; ayrica subnet yeniden kullanilirsa koruma HAZIR olur).
while read -r inst sn _rest; do
  [ -n "${inst:-}" ] || continue
  case "${sn:-}" in ''|*[!0-9]*) atlandi=$((atlandi+1)); continue ;; esac
  [ "$sn" -ge 1 ] && [ "$sn" -le 254 ] || { atlandi=$((atlandi+1)); continue; }
  net="192.168.$sn.0/24"
  if "$IPT" -C FORWARD -s "$net" -p tcp -j DROP 2>/dev/null; then
    vardi=$((vardi+1))
  elif "$IPT" -I FORWARD 1 -s "$net" -p tcp -j DROP 2>/dev/null; then
    eklendi=$((eklendi+1))
  fi
done < "$MAP"

say "kill-switch: eklendi=$eklendi zaten-vardi=$vardi atlandi=$atlandi"
echo "kill-switch: eklendi=$eklendi zaten-vardi=$vardi atlandi=$atlandi"
exit 0
