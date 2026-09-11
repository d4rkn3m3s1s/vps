---
name: wsl-redroid-netstack-route-fix
description: "★KÖK SEBEP★ WSL internet'i sürekli koparan gizem çözüldü: WSL içindeki redroid Android container'larının netstack'i fwmark policy kurallarını (tablo 97/98/99 + 'from all unreachable') saniyeler içinde geri koyup eklediğin her route'u siliyordu; çözüm = redroid'leri durdur + fwmark tablolarına default route ekle"
metadata:
  node_type: memory
  type: project
  originSessionId: b56ece3b
---

**2026-07-04: WSL'de "internet 5 saniyede ölüyor / cloudflared+agent bağlanamıyor" gizemi çözüldü.**

## Belirti
- `up.sh` "default route ok" der ama saniyeler sonra `ping 1.1.1.1` = "Network is unreachable".
- Eklediğin `ip route`/`ip rule` ~2-5 sn içinde SİLİNİYOR. `getent`/ping bir an çalışıp kesiliyor.
- cloudflared quick-tunnel: `dial udp 8.8.8.8:53: connect: network is unreachable`.

## KÖK SEBEP
WSL içinde **redroid Android container'ları** (`fleet-local-phone-01/02/03`, docker-compose, `androidboot.hardware=redroid`) ana net namespace'de çalışıyor. Android'in `init` + `com.android.networkstack.process`'i kendi VPN/tethering **fwmark policy kurallarını** sürekli enjekte ediyor:
```
10000: from all fwmark 0xc0000/0xd0000 lookup 99
16000: from all fwmark 0x10063/0x1ffff iif lo lookup 97
18000: from all fwmark 0/0x10000 lookup 99   ← düz trafik (fwmark 0) buraya
19000: ... lookup 98
20000: ... lookup 97
32000: from all unreachable                   ← main tabloya ULAŞMADAN blokluyor
```
Bu kurallar `.wslconfig`'in dnsTunneling/firewall'ından DEĞİL, **Android netstack'inden** geliyordu (o yüzden `.wslconfig` değişikliği tek başına çözmedi). `from all unreachable` (32000) main tablodaki default route'a ulaşmayı engelliyor; düz trafik 97/98/99 tablolarına düşüyor ama oralarda default route YOK → unreachable.

## ÇÖZÜM (kalıcı, kurallarla YARIŞMADAN)
1. **redroid telefonları durdur** (WhatsApp cihazı Scaleway Waydroid'de, bu WSL redroid'ler LEGACY — [[three-redroid-phones]] / [[local-android-test-stack]]):
   `echo 163244 | sudo -S docker kill fleet-local-phone-01 fleet-local-phone-02 fleet-local-phone-03`
   (S() fonksiyonu çok-arglı komutlarda "sudo: : command not found" verir → docker kill'i TEK satır düz `echo pw | sudo -S docker kill ...` yaz.)
2. **fwmark tablolarına default route ekle** — Android'in yönlendirdiği tablolara çıkış ver (kuralları silmeye çalışma, geri geliyorlar):
   ```
   echo 163244 | sudo -S bash -c 'for t in 97 98 99; do ip route replace default via 172.31.64.1 dev eth0 onlink table $t; done'
   ```
   Gateway = WSL subnet'in `.1`'i (NAT modda). 2026-07-04'te subnet `172.31.64.0/20` → gw `172.31.64.1`. Windows'ta doğrula: `Get-NetIPAddress | ? InterfaceAlias -like '*WSL*'`. Ana default route de: `ip route replace default via <gw> dev eth0 onlink` (dockerd silince `onlink` ŞART, yoksa "Nexthop has invalid gateway").
3. Doğrula: `ping -c1 1.1.1.1` + `curl -4 https://github.com` (200) + `ip route get 8.8.8.8` → `table 99 via <gw>`.

## Yan notlar
- `.wslconfig` (`C:\Users\furka\.wslconfig`): `networkingMode=nat`; dnsTunneling/firewall/autoProxy'yi `false` yaptım (yedek `.wslconfig.bak-dnstunnel`). Yardımcı ama tek başına yetmez.
- WSL restart sonrası subnet DEĞİŞİR → portproxy'yi güncelle (netsh, ELEVATED gerekir): `netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=3000/4000 connectaddress=<wsl-ip> connectport=...`. netsh portproxy add YÖNETİCİ ister (`Start-Process powershell -Verb RunAs`).
- cloudflared: WSL `run_in_background` ile canlı kalır; `nohup setsid ... & disown` WSL `bash -lc` çıkışında ölür. `pkill -f "cloudflared tunnel"` KENDİ komutunu da öldürebilir → dikkat. Foreground `timeout 18 cloudflared ...` ile URL'yi hızlı yakala.

İlişkili: [[local-stack-startup]] [[wsl-nat-networking-fix]] [[whatsapp-stable-api-inbound]] [[waydroid-uinput-real-touch-SOLVED]].
