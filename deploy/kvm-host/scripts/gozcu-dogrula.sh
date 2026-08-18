#!/bin/bash
# GOZCU KAPSAMINI CIHAZ BAZINDA DOGRULAR (birim sayisi degil — GERCEK cihaz eslesmesi).
#
# ★NEDEN boyle: `systemctl list-units waydroid@*` sayimi YANILTICI — silinen cihazlarin
# hayalet birimleri (inactive/dead) de sayiliyor. Dogru olcut: ADB'de BAGLI her cihazin
# instance'ini bul, o birimin SubState'i `running` mi (= wd-run yasiyor = gozcu donuyor).

: > /tmp/_gozcu_yok.txt
VAR=0; YOK=0; ESLESMEDI=0

for S in $(adb devices | grep -w device | cut -f1); do
  IP=${S%%:*}
  OKT=$(echo "$IP" | cut -d. -f3)
  I=$(grep -E " $OKT\$" /var/lib/waydroid-subnets.map 2>/dev/null | awk '{print $1}' | head -1)
  if [ -z "$I" ]; then ESLESMEDI=$((ESLESMEDI+1)); echo "$S (instance bulunamadi)" >> /tmp/_gozcu_yok.txt; continue; fi
  SUB=$(systemctl show "waydroid@$I" -p SubState --value 2>/dev/null)
  if [ "$SUB" = "running" ]; then
    VAR=$((VAR+1))
  else
    YOK=$((YOK+1)); echo "$I ($S) -> $SUB" >> /tmp/_gozcu_yok.txt
  fi
done

echo "=== GOZCU KAPSAMI (cihaz bazinda) ==="
echo "  ADB'de bagli cihaz : $((VAR+YOK+ESLESMEDI))"
echo "  gozcu VAR          : $VAR"
echo "  gozcu YOK          : $YOK"
echo "  instance eslesmedi : $ESLESMEDI"
[ -s /tmp/_gozcu_yok.txt ] && { echo "  --- kapsam disi ---"; head -10 /tmp/_gozcu_yok.txt; }
