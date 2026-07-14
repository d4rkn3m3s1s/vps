# Fleet APK deposu

Cihaz provizyonunda (Waydroid cloud phone) kurulan APK'lar. Git LFS ile
saklanır (`.gitattributes` → `*.apk filter=lfs`). Yeni bir host kurarken veya
bir cihaza uygulama kurarken buradan alınır — kaynağı tekrar aramak gerekmez.

| Dosya | Paket | Sürüm | Boyut | Amaç |
|-------|-------|-------|-------|------|
| `whatsapp.apk` | `com.whatsapp` | v2.26.25.81 | ~137 MB | WhatsApp otonom kayıt/mesajlaşma |
| `magisk.apk` | `io.github.huskydg.magisk` | huskydg delta | ~12 MB | Root (Magisk delta) |
| `fleet-a11y.apk` | `com.fleet.a11y` | — | ~17 KB | Erişilebilirlik servisi (RPA/otomasyon) |
| `adbkeyboard.apk` | `com.android.adbkeyboard` | — | ~18 KB | Metin girişi (broadcast ile IME) |

## Kurulum (cihaza)

Panelden **APK'lar** sayfası → cihaz seç → tek-tık kur. Elle kurulum için
(büyük APK'da ADB push boğulur, host-mount kullan):

```bash
# host-mount: cihaz /data/local/tmp = /root/.local/share/waydroid.<INST>/data/local/tmp
sudo cp deploy/apks/whatsapp.apk /root/.local/share/waydroid.<INST>/data/local/tmp/
sudo chmod 666 .../whatsapp.apk && sudo chown 2000:2000 .../whatsapp.apk
sudo lxc-attach -n waydroid -P /var/lib/waydroid.<INST>/lxc -- pm install -r -g /data/local/tmp/whatsapp.apk
```

Kaynak: phoenixNAP çalışan cihazdan `pm path <pkg>` + `adb pull` ile çekildi.
