#!/system/bin/sh
# Boot-persist route (Magisk service.d) — Android netd her boot table eth0 route-tablosunu
# TEMIZLER. Uygulama-trafigi table eth0 kullanir; orada default-route YOKSA internet YOK
# (TCP 000). Bu script her boot-completed sonrasi ilk ~3dk (netd-aktif penceresi) table
# eth0/main/local_network'e default-route'u geri ekler. GW provision tarafindan yazilir.
GW=__GATEWAY__
(
  until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 3; done
  i=0
  while [ $i -lt 18 ]; do
    for T in eth0 main local_network; do
      ip route add default via $GW dev eth0 table $T 2>/dev/null
    done
    i=$(($i + 1))
    sleep 10
  done
) &
