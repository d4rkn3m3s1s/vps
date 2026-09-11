---
name: kurtarma-sistemi-ssh-siz-2026-08-14
description: "SSH ölüyken müdahale yolları: /kurtar HTTP ucu (token'lı), port 2222 acil SSH (UsePAM no), watchdog (Telegram onaylı, OTOMATIK REBOOT YOK)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-14T20:39:45.199Z
---

**14 Ağustos 2026** kurulan kurtarma katmanları. Sebep: o gün 3 kilit yaşandı ve her
seferinde tek çare IPMI power cycle'dı (bkz. [[proc-taramasi-systemd-kilidi-2026-08-14]]).

## 1. HTTP kurtarma ucu — `/kurtar`

**En değerlisi.** Kilitlerin hepsinde API 200 dönmeye devam etti → bu kanal hayatta kalıyor.

```
http://125.253.73.45/kurtar/durum?token=<TOKEN>
http://125.253.73.45/kurtar/eylem?ad=<eylem>&token=<TOKEN>
```

- Token: `/opt/fleet-agent/state/kurtar.token` (0600). **Sunucuda üretilir**, izin
  sınıflandırıcısı bana token yazdırmıyor → komutu kullanıcı çalıştırır.
- **Hiçbir eylem systemd'ye bağımlı DEĞİL** — `systemctl stop` tıkalıyken asılı kalır,
  onun yerine **doğrudan `pkill`** kullanılır.
- Eylemler: `durdur-betikler` · `durdur-kapilar` · `durdur-agent` · `baslat-agent` ·
  `panik` (hepsi + agent, **cihazları KAPATMAZ**) · `log-fren` · `log-izle` ·
  `log-watchdog` · `reboot-zorla` (sysrq, `&onay=evet` şart)
- Token'sız/yanlış token → **401** (test edildi).
- Servis: `wd-kurtar` (Node, 127.0.0.1:4700), Caddy `/kurtar` → 4700.

## 2. Acil SSH kapısı — port 2222

Normal SSH ölürken sshd suçsuzdur: **PAM → `pam_systemd` → logind D-Bus** çağrısı
systemd tıkalıyken asılı kalır, giriş asla tamamlanmaz. `UsePAM no` bu zinciri atlar.

```bash
ssh -p 2222 -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45
```

- Config: `/etc/ssh/sshd_acil_config`, servis `sshd-acil`, ufw 2222 açık.
- ⚠️ **TUZAK:** `UsePAM no` iken sshd **kilitli hesabı reddeder** →
  `User ubuntu not allowed because account is locked`. Çözüm: `usermod -p "*" ubuntu`
  (`!` = kilitli → `*` = parola yok). Parola girişi yine imkânsız.
- ⚠️ **`scp` port 2222'de ÇALIŞMAZ** — config'e `Subsystem sftp` konmadı. Dosya
  kopyalarken port 22 kullan (veya `scp -O`).

## 3. Watchdog — `wd-watchdog`

30 sn'de bir **systemd yanıt süresi** ölçer (D-state/load değil — onlar yanıltıcı).

| Kademe | Süre | Eylem | Otomatik? |
|---|---|---|---|
| 1 | 5 dk | Açılış/onarım betiklerini `pkill` | ✅ |
| 2 | 10 dk | Agent + bekleyen boot-gate kapıları | ✅ |
| 3 | 20 dk | **Telegram'a tek dokunuşluk reboot ONAY LİNKİ** | ❌ |

**OTOMATIK REBOOT YOK** (kullanıcı isteği: "onaylanmazsa yapılmasın, reboot çok
sıkıntılı"). Dosyada `sysrq|reboot|shutdown` geçmiyor — sadece mesaj atar.

## Telegram ayarı — sessiz başarısızlık tuzağı

- Bot anahtarı: `/opt/fleet/apps/api/.env` → `TELEGRAM_BOT_TOKEN` (açık metin).
- ⚠️ **chatId env'de YOK** — API'de `NotificationChannel.configEnc` içinde
  **AES-256-GCM şifreli**, kabuktan okunamaz.
- Çözüm: `/opt/fleet-agent/state/tg.conf` → `TG_CHAT=588495279` (@vpswabot).
- ⚠️ İlk sürümde env yolu yanlıştı → bildirimler **sessizce gitmiyordu**. Canlı test
  şart: `sendMessage` → `{"ok":true}` görülmeli.

## Canlı durum sayfası — `/durum`

`http://125.253.73.45/durum` · 10 sn'de yenilenir · `wd-izle` (20 sn kayıt) +
`wd-durum` (HTML üretici). Kartlar + D-state/cihaz grafikleri + fren kaydı.
Alanlar: `acik/kuyruk/adb/off/D/sd(systemd ms)/load/RAM/cpuidle/agent/fren`.

İlgili: [[proc-taramasi-systemd-kilidi-2026-08-14]]
