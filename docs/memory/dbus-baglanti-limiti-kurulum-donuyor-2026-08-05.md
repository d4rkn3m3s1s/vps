---
name: dbus-baglanti-limiti-kurulum-donuyor-2026-08-05
description: "🔴★★★ 127 CİHAZDA TAVAN: yeni kurulum 'Cihaz açılışı bekleniyor'da DONUYOR. Kök neden `DBus.Error.LimitsExceeded` (max_connections_per_user=256, ölçüm 264). ⚠️PANEL YANILTIYOR: 'eth0 IPv4 gecikti — DHCP re-kick' diyor ama DHCP SUÇSUZ — container hiç başlamadığı için IP alacak arayüz YOK. FIX yazıldı ama `reload` UYGULAMIYOR, reboot şart."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-05T21:12:26.892Z
---

# D-Bus bağlantı limiti → 127 cihazda yeni kurulum DONUYOR

## Belirti
Panelde kurulum `%18 · Cihaz açılışı bekleniyor`da takılı kalıyor, ilerlemiyor:
```
boot▸ ⚠ eth0 IPv4 gecikti — DHCP yeniden tetikleniyor…
[prov mi219] eth0 IPv4 gecikti — DHCP re-kick #7 @ 66s
```

## ⚠️ BELİRTİ YANILTICI — DHCP SUÇSUZ
Agent 7 kez boşuna DHCP tetikliyor. Gerçek: **container HİÇ BAŞLAMADI**, dolayısıyla
IP alacak bir arayüz yok. `wd-run.sh` ve `weston` ayakta ama **`lxc-start` YOK**.

## ★★★ KÖK NEDEN — `/var/log/<inst>-ct.log`
```
ERROR: org.freedesktop.DBus.Error.LimitsExceeded:
The maximum number of active connections for UID 0 has been reached
```
**ÖLÇÜM: 264 bağlantı / 256 limit** (D-Bus varsayılanı `max_connections_per_user`).
Her Waydroid instance ~2 sistem-bus bağlantısı tutuyor → **127 cihazda TAVAN**.

## Teşhis zinciri (sırayla bakılacak yerler)
```bash
systemctl is-active waydroid@<inst>          # inactive → container hiç başlamamış
pgrep -af "wd-run.sh <inst>"                 # VAR (script çalışıyor)
pgrep -af "lxc-start.*<inst>"                # YOK ← asıl işaret
sudo tail /var/log/<inst>-ct.log             # ★ GERÇEK HATA BURADA
sudo tail /var/log/<inst>-sess.log           # "WayDroid container is not listening"
sudo ss -x | grep -c system_bus_socket       # bağlantı sayısı (>250 ise tavan)
```
⚠️ `journalctl -u waydroid@<inst>` **BOŞ** döner (servis hiç başlatılmadı) — bu yüzden
oraya bakıp "log yok" deyip geçme; asıl log `/var/log/<inst>-ct.log`.

## FIX (yazıldı, AKTİF DEĞİL)
`/etc/dbus-1/system.conf` oluşturuldu (`/usr/share/dbus-1/system.conf` bunu
`<include ignore_missing="yes">` ile okur):
```xml
<busconfig>
  <limit name="max_connections_per_user">1024</limit>
  <limit name="max_completed_connections">4096</limit>
</busconfig>
```

## ⚠️ `reload` UYGULAMIYOR
`systemctl reload dbus` "Reloaded configuration" der (logda görülür) **ama limit
DEĞİŞMEZ** — `max_connections_per_user` yalnızca BAŞLANGIÇTA okunuyor.

## ✅ ÇÖZÜLDÜ (5 Ağu 21:06) — bakım penceresiyle, SIFIR KAYIP

★★★ **`systemctl restart dbus` TEK BAŞINA YETMEDİ.** Servis yeniden başladı ama
**ESKİ, ÖLÜ SOKETE bağlı kaldı** (soket dosyası 20:36 tarihliydi, servis 21:05'te
başladı) → `DBus.Error.NoServer: Connection refused`.

**ÇÖZÜM — socket unit'i DE restart et:**

    systemctl restart dbus.socket
    systemctl restart dbus.service
    # doğrula (yanıt gelmeli):
    dbus-send --system --print-reply --dest=org.freedesktop.DBus / org.freedesktop.DBus.ListNames
    # soket dosyasının tarihi YENİ olmalı:
    ls -la /run/dbus/system_bus_socket

**SONUÇ:** D-Bus bağlantı **264 → 0**, limit **1024 aktif**. Cihaz süreci 125,
REDIRECT 136, redsocks 126 — **HİÇBİRİ DÜŞMEDİ**. ADB ✓, proxy çıkışı TR ✓,
fleet-api/agent/dashboard active, agent hatası 0.

⚠️ **Neden cihazlar etkilenmedi:** çalışan container'lar D-Bus'a SÜREKLİ bağlı
DEĞİL — yalnızca BAŞLARKEN kullanıyorlar. Bu yüzden restart onları düşürmedi.
(Yine de bakım öncesi tam güvenlik ağı kuruldu; bkz. aşağıda.)

## Bakım penceresi reçetesi (sıfır kayıpla tekrarlanabilir)
1. Aktif kayıt YOK mu doğrula (`REGISTERING`/`AWAITING_OTP` = 0)
2. `sudo /opt/fleet-backup.sh` (~45sn, 1.2GB)
3. `sudo /opt/fleet-recovery/fleet-restore.sh check` → çıktıyı sakla
4. `systemctl restart dbus.socket && systemctl restart dbus.service`
5. `fleet-restore.sh check` → karşılaştır; bir şey düştüyse `fleet-restore.sh all`

**Güvenlik ağı** (`/opt/fleet-recovery/`, filo çalışırken kuruldu):
- `iptables-nft-latest.rules` — **136 REDIRECT** ⚠️ proxy kuralları **nft** tarafında,
  legacy'de 0. Sadece `iptables-save` almak YARIM yedek olur; `iptables-nft-save` şart.
- `inst-country-latest.txt` — 125 cihazın instance/ülke/port haritası
- `fleet-restore.sh {check|proxy|devices|all}` — idempotent, canlıda test edildi
  (çalışan filoda hiçbir şeye dokunmadı)

⚠️ **Cihazlar systemd ile YÖNETİLMİYOR** (0 unit, hepsi elle `wd-run.sh`) ve
`iptables-persistent` KURULU DEĞİL → gerçek bir REBOOT'ta cihazlar da, 136 REDIRECT
kuralı da GERİ GELMEZ. `fleet-restore.sh all` tam da bunun için var.

## Durum doğrulaması (fix sonrası, hiçbir şey bozulmadı)
`container: 125` · `dbus: active` · fleet-api/agent/dashboard **active** · ADB yanıt veriyor.
⚠️ Reload denemesi sırasında `systemctl is-active dbus` sudo'suz "Connection refused"
dönebilir — bu PANİK SEBEBİ DEĞİL, bağlantı limiti dolu olduğu için; `sudo` ile `active`.

İlgili: [[phoenixnap-KAPASITE]] · [[ufw-dhcp-dns-koku-2026-07-28]] (o da "DHCP suçlu
sanılan" bir vakaydı) · [[container-ip-path-koku-2026-07-28]]
