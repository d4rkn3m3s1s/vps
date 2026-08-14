# Kurtarma katmanları (SSH ölüyken müdahale)

**Neden var:** 14 Ağustos 2026'da sistem **bir günde üç kez** kilitlendi (biri 5 saat
sürdü) ve her seferinde tek çare IPMI power cycle oldu. Kilidin imzası hep aynıydı:

- `systemctl` yanıt vermez → `Failed to retrieve unit state: Connection timed out`
- **SSH girişi açılmaz**, ama port 22 açık *görünür*
- **API 200 dönmeye devam eder** (zaten çalışan süreç, `/proc`'a dokunmuyor)
- Cihazlar çalışmaya devam eder (WhatsApp mesajı bile gelir)

## ★★★ Kilidin kök sebebi

Yük freni her 12 saniyede **`ps -eo stat`** çalıştırıyordu. `ps -e` `/proc` altındaki
**tüm süreçleri tarar** — bu hostta on binlerce. 76–156 cihaz aynı anda kapıda
beklerken **76–156 eşzamanlı `/proc` taraması** oluyordu.

`/proc` tıkanınca zincir: systemd tıkanır (o da `/proc` okur) → `systemctl` ölür →
**SSH girişi ölür** (PAM → `pam_systemd` → logind D-Bus) → yönetim kör kalır.

> Yani *"yük freni"nin kendisi* yükü yaratıyordu.
> **Kanıt:** 22:22'de sistem bomboştu (D=2, load=33, CPU %85 boşta). 76 cihaz
> tetiklendi → **90 saniyede** SSH tamamen kilitlendi.

Aynı hata ikinci bir yerde de vardı: izleyicideki `top -bn1`.

### Kural

**Bu dizindeki betiklerde `/proc` TARAYAN komut olmayacak.**
`ps -e`, `top`, `pgrep -f`, `lsof` → **yasak** (tek seferlik acil teşhis hariç).

Yerine:

| İhtiyaç | Ucuz yöntem |
|---|---|
| D-state sayısı | `awk '/^procs_blocked/{print $2}' /proc/stat` |
| CPU boşta % | `/proc/stat` iki ölçümün farkı |
| Çalışan container | bridge'in üye arayüzü var mı (`/sys/class/net/waydroid-*/brif`) |

### ★★ Asıl sinyal: systemd yanıt süresi

D-state ve load **yanıltıcı** — kilit anlarında D=1–6 ve CPU %60–85 boştaydı.
Doğru ölçüm:

```bash
S=$(date +%s%N); timeout 8 systemctl is-system-running >/dev/null 2>&1; E=$(date +%s%N)
MS=$(( (E-S)/1000000 ))   # sağlıklı: 8–30ms · tıkalı: 5000ms+ / timeout
```

---

## Katmanlar

### 1. `wd-kurtar.mjs` — HTTP kurtarma ucu (en değerlisi)

Kilitlerin hepsinde API 200 dönmeye devam etti → bu kanal hayatta kalıyor.

```
http://<host>/kurtar/durum?token=<TOKEN>
http://<host>/kurtar/eylem?ad=<eylem>&token=<TOKEN>
```

- Token: `/opt/fleet-agent/state/kurtar.token` (0600). Sunucuda üretilir.
- **Hiçbir eylem systemd'ye bağımlı değil** — `systemctl stop` tıkalıyken asılı
  kalır, onun yerine doğrudan `pkill` kullanılır.
- Token'sız / yanlış token → **401**.

| Eylem | Ne yapar |
|---|---|
| `sifirla-agent` | Agent + canlı yayın kanalını sıfırlar (**panel butonu bunu çağırır**) |
| `durdur-betikler` | Açılış/onarım betiklerini keser (kilitlerin #1 sebebi) |
| `durdur-kapilar` | Takılı `wd-boot-gate` kapılarını serbest bırakır |
| `durdur-agent` / `baslat-agent` | Agent süreci |
| `panik` | Hepsi + agent durur — **cihazlar KAPANMAZ** |
| `log-fren` / `log-izle` / `log-watchdog` | Kayıtlar |
| `reboot-zorla` | Son çare (sysrq). `&onay=evet` şart |

### 2. `sshd_acil_config` — acil SSH kapısı (port 2222)

Normal SSH'ın ölme sebebi sshd değil: PAM'in `pam_systemd` modülü her girişte
systemd-logind'e D-Bus çağrısı yapar; systemd tıkalıyken o çağrı asılı kalır.
`UsePAM no` bu zinciri atlar.

```bash
ssh -p 2222 -i ~/.ssh/<key> ubuntu@<host>
```

⚠️ **İki tuzak:**
- `UsePAM no` iken sshd **kilitli hesabı reddeder** →
  `User ubuntu not allowed because account is locked`.
  Çözüm: `usermod -p "*" ubuntu` (`!` = kilitli → `*` = parola yok).
  Parolayla giriş yine imkânsız (`PasswordAuthentication no`).
- **`scp` bu portta çalışmaz** — config'de `Subsystem sftp` yok. Dosya için port 22.

### 3. `wd-watchdog.sh` — kademeli otomatik kurtarma

30 saniyede bir systemd yanıt süresini ölçer.

| Kademe | Süre | Eylem | Otomatik? |
|---|---|---|---|
| 1 | 5 dk | Açılış/onarım betiklerini `pkill` | ✅ |
| 2 | 10 dk | Agent + bekleyen boot kapıları | ✅ |
| 3 | 20 dk | **Telegram'a tek dokunuşluk reboot onay linki** | ❌ |

**Otomatik reboot YOK** (operatör kararı: "onaylanmazsa yapılmasın"). Dosyada
`sysrq|reboot|shutdown` geçmez — sadece mesaj atar.

Telegram ayarı:
- Bot anahtarı: `/opt/fleet/apps/api/.env` → `TELEGRAM_BOT_TOKEN` (açık metin)
- ⚠️ chatId env'de **yok** — API'de `NotificationChannel.configEnc` içinde
  AES-256-GCM şifreli. Kabuktan okunamaz → `/opt/fleet-agent/state/tg.conf`
  içinde `TG_CHAT=<id>` olarak tutulur.
- ⚠️ İlk sürümde env yolu yanlıştı → bildirimler **sessizce** gitmiyordu.
  Değişiklikten sonra canlı test şart: `sendMessage` → `{"ok":true}` görülmeli.

### 4. `wd-izle.sh` + `durum-uret.sh` — canlı durum sayfası

`http://<host>/durum` · 10 saniyede bir yenilenir · `/proc` taraması yok.

Kayıt alanları: `acik` (gerçek container) · `sysd` (systemd sayımı) · `kuyruk` ·
`adb` · `off` · `D` · `sd` (systemd ms) · `load` · `RAM` · `cpuidle` · `agent` · `fren`

> ⚠️ `sysd` ile `acik` **kasten** ayrı: `health-watch` zombi cihazları `wd-run.sh`
> ile doğrudan başlatır (systemd üzerinden değil), o yüzden systemd sayımı eksik
> kalır. Canlı ölçüm: systemd=135, **gerçek=152**, ADB=140 — operatör "cihazlar
> düşüyor" diye panikledi, oysa filo büyüyordu.

### 5. `wd-fren.sh` — şişme freni

D-state ≥ 50 (2 üst üste ölçüm) veya boş RAM ≤ 20 GB → açılış betiklerini ve
agent'ı durdurur. **Çalışan cihazlara dokunmaz** (ilk sürüm dokunuyordu, 41 cihazı
boşuna kapattı). Load eşik **değildir** — yanıltıcıdır.

### 6. `wd-saglik.sh` — paralel sağlık taraması

40 paralel; her cihaz için IP / boot / ADB / DNS / **proxy çıkış IP**.

⚠️ Container içindeki komutlar **tam yolla** çağrılmalı (`/system/bin/ip`,
`/system/bin/getprop`, `/system/bin/curl`). systemd ortamında PATH container'a
aktarılır ve `/system/bin` içermez → `Failed to exec "ip"` (status 127) → her cihaz
`NOIP` görünür. Elle çalıştırınca sorun görünmez (kabuk PATH'i farklı).

---

## Kurulum

```bash
# 1) Betikler
sudo install -m 755 wd-*.sh durum-uret.sh /opt/fleet-agent/
sudo install -m 755 wd-kurtar.mjs         /opt/fleet-agent/
sudo install -m 755 ../waydroid/wd-boot-gate.sh /opt/fleet-agent/waydroid/

# 2) Token
date +%s%N | sha256sum | head -c 32 | sudo tee /opt/fleet-agent/state/kurtar.token
sudo chmod 600 /opt/fleet-agent/state/kurtar.token

# 3) Telegram chat id
echo "TG_CHAT=<chat-id>" | sudo tee /opt/fleet-agent/state/tg.conf

# 4) systemd
sudo install -m 644 systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wd-kurtar wd-watchdog wd-izle wd-durum wd-fren wd-adb-tara

# 5) Acil SSH kapısı
sudo install -m 644 sshd_acil_config /etc/ssh/sshd_acil_config
sudo usermod -p "*" ubuntu          # ← şart, yoksa "account is locked"
sudo ufw allow 2222/tcp
sudo systemctl enable --now sshd-acil

# 6) Caddy: /kurtar ve /durum yollarını ekle
#    @kurtar path /kurtar /kurtar/*   → reverse_proxy 127.0.0.1:4700
#    @durum  path /durum  /durum/*    → root /opt/fleet-agent/state, rewrite /durum.html
```

## Panelden müdahale

Hosts sayfasında **"Agent'ı sıfırla"** butonu → `POST /hosts/:id/agent/reset` →
API kurtarma ucunu (`127.0.0.1:4700`) çağırır → `sifirla-agent`.
API'nin root yetkisi yoktur; bu yüzden iş root çalışan kurtarma ucuna devredilir.
