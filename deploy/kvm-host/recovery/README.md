# Host kurtarma araçları

Sunucuda `/opt/fleet-recovery/` altında yaşarlar. Buradaki kopyalar versiyonlanmış
kaynak; sunucuya elle kopyalanır (host'ta git yok).

## Neden var

Bu kurulumda iki şey **kalıcı değil** ve bir reboot'ta geri gelmez:

1. **Cihaz süreçleri** — Waydroid instance'ları systemd ile yönetilmiyor (0 unit);
   hepsi elle `wd-run.sh <inst>` ile başlatılmış.
2. **iptables REDIRECT kuralları** — `iptables-persistent` kurulu değil. Proxy
   yönlendirmesi bunlara bağlı; kaybolursa cihazlar **datacenter IP'sinden çıkar**
   ve WhatsApp hesapları banlanır (21 Tem'de bir kez yaşandı).

WhatsApp hesapları güvende: `/data` fiziksel diskte (ext4/LVM), restart onu korur.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `fleet-restore.sh` | Filoyu geri getirir — `check` / `proxy` / `devices` / `all` |
| `dbus-system.conf` | D-Bus root bağlantı limiti 256 → 1024 (`/etc/dbus-1/system.conf`) |

## Kullanım

```bash
sudo /opt/fleet-recovery/fleet-restore.sh check     # sadece raporla (önce BUNU çalıştır)
sudo /opt/fleet-recovery/fleet-restore.sh proxy     # iptables + redsocks geri yükle
sudo /opt/fleet-recovery/fleet-restore.sh devices   # cihazları partiler hâlinde başlat
sudo /opt/fleet-recovery/fleet-restore.sh all       # proxy + cihazlar
```

Betik **idempotent** — çalışan bir filoda hiçbir şeye dokunmaz (canlıda test edildi).
Cihazları `FLEET_RESTORE_BATCH` (varsayılan 4) kadar partiler hâlinde, aralarında
`FLEET_RESTORE_GAP` (25sn) bekleyerek başlatır; 127 boot aynı anda host'u boğar.

## Betiğin okuduğu durum dosyaları

Sunucuda `/opt/fleet-recovery/` altında tutulur, **repoda değildir** (canlı duruma özgü):

- `iptables-nft-latest.rules` — REDIRECT kuralları
- `iptables-legacy-latest.rules` — ufw vb.
- `inst-country-latest.txt` — `<instance> <ülke> <port>` (cihaz başına satır)

Bakım öncesi tazelemek için:

```bash
sudo iptables-nft-save    | sudo tee /opt/fleet-recovery/iptables-nft-latest.rules >/dev/null
sudo iptables-legacy-save | sudo tee /opt/fleet-recovery/iptables-legacy-latest.rules >/dev/null
for f in /etc/redsocks-inst-*.conf; do
  i=$(basename "$f" .conf | sed 's/redsocks-inst-//')
  cc=$(grep -oE 'country-[A-Za-z0-9]+' "$f" | head -1 | cut -d- -f2)
  p=$(grep -E '^\s+port = ' "$f" | grep -oE '[0-9]+' | tail -1)
  [ -n "$cc" ] && echo "$i $cc $p"
done | sudo tee /opt/fleet-recovery/inst-country-latest.txt >/dev/null
```

> ⚠️ **`iptables-save` yetmez.** Bu host'ta iki arka uç var: proxy REDIRECT kuralları
> **nft** tarafında (136 kural), legacy'de 0. `iptables-nft-save` kullanılmazsa yedek
> yarım kalır.

## D-Bus limiti

`dbus-system.conf` → `/etc/dbus-1/system.conf` olarak kopyalanır.

Varsayılan `max_connections_per_user=256`; her Waydroid instance ~2 sistem-bus
bağlantısı tutar → **127 cihazda tavana çarpılır** ve yeni kurulum
`DBus.Error.LimitsExceeded` ile sessizce donar (panel yanıltıcı biçimde
"eth0 IPv4 gecikti — DHCP re-kick" gösterir; gerçek hata `/var/log/<inst>-ct.log`).

Aktifleştirme (reload YETMEZ — limit yalnızca başlangıçta okunur):

```bash
sudo systemctl restart dbus.socket
sudo systemctl restart dbus.service
sudo dbus-send --system --print-reply --dest=org.freedesktop.DBus / org.freedesktop.DBus.ListNames
```

> ⚠️ `restart dbus.service` **tek başına yetmez** — servis yeniden başlar ama eski,
> ölü sokete bağlı kalır (`DBus.Error.NoServer`). `dbus.socket` de restart edilmeli.
>
> Çalışan cihazlar bundan etkilenmez: container'lar D-Bus'a sürekli bağlı değil,
> yalnızca başlarken kullanıyorlar (5 Ağu'da 125 cihazla doğrulandı, sıfır kayıp).
