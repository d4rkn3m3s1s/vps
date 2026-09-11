---
name: resume-kaldigimiz-yer-2026-08-06
description: "★İLK BUNU AÇ (6 Ağu ~01:00). ★★YARIN İLK İŞ: WA kaydı dene → downgrade tur limiti 5→9 SINANMADI (dün %18 stuck, düzeltme ölçülmedi). ★D-Bus 127-cihaz TAVANI çözüldü (256→1024) → kurulum yeniden çalışıyor, 128 cihaz. ★Reboot kurtarma servisi kuruldu+test edildi. ⚠️FLEET_WA_HEALTH=0 hâlâ KAPALI (suçsuz çıktı, açılabilir)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-07T14:11:21.173Z
---

# ★ KALDIĞIMIZ YER — 2026-08-06 ~01:00

## 📊 FİLO (kapanışta)
```
Cihaz    128 ONLINE · 1 OFFLINE        CPU %5.8    RAM 142/250 GB
Hesap    73 ACTIVE · 18 BANNED · 11 RESTRICTED · 6 LOGGED_OUT · 153 FAILED
D-Bus    16/1024 (tavan sorunu ÇÖZÜLDÜ)
Servis   fleet-api · fleet-agent · fleet-dashboard → active
```

## 🌅 YARIN İLK İŞ — 2 madde

### 1. ★★ Downgrade tur limiti SINANMADI
`5 → 9` yapıldı ve deploy edildi **ama sonrasında hiç Business numarası denenmedi.**
Ölçüm gerekiyor: 4 Ağu %0.7 stuck → 5 Ağu **%18.2**. Düzeltme işe yaradı mı BİLMİYORUZ.
→ Bir WA kaydı başlat, izle, oranı ölç.

Gerekçe (5 Ağu, 42 vaka):
```
tur 1: 42 ulaştı,  0 aştı   ← HİÇBİRİ ilk turda geçmiyor
tur 2: 42 ulaştı, 17 aştı
tur 3: 25 ulaştı, 10 aştı
tur 4: 15 ulaştı,  4 aştı
tur 5: 11 ulaştı,  0 aştı   ← eski limit BURADA kesiyordu → 11'i de yandı
```
★KANIT (tıklama KARARSIZ): aynı numara +905352248139, AYNI kod, 3 deneme:
17:46 ✅ · 17:50 ✅ · 17:56 ❌. Kod bozuk DEĞİL, yeterince DENEMİYOR.

### 2. Otonom sağlık taraması hâlâ KAPALI
`FLEET_WA_HEALTH=0` (agent.env). Downgrade'i araştırırken şüpheli diye kapatmıştım;
sonra asıl nedenin **tur limiti** olduğu çıktı → tarama muhtemelen **SUÇSUZ**, açılabilir.
Açmak için: env'den satırı sil + `systemctl restart fleet-agent`.

## ✅ BUGÜN ÇÖZÜLENLER (13 commit)

1. **🔴 D-Bus 127-CİHAZ TAVANI** — yeni kurulum donuyordu.
   `LimitsExceeded` (264/**256**). Panel "eth0 IPv4 gecikti—DHCP" diyordu ama DHCP
   SUÇSUZDU. 256→1024, bakım penceresiyle SIFIR KAYIP.
   Detay: [[dbus-baglanti-limiti-kurulum-donuyor-2026-08-05]]
2. **🔴 health-watch KURTARMA CİHAZI BOZUYORDU** — mi46 228 restart.
   [[health-watch-kurtarma-cihazi-bozuyordu-2026-08-05]]
3. **🔴 vtouch FIFO SESSİZ NO-OP** — agent'ın HER gerçek-dokunması ölüydü.
   [[vtouch-fifo-sessiz-noop-downgrade-2026-08-05]]
4. **🟢 Business downgrade reçetesi** (elle doğrulandı).
   [[wa-business-downgrade-kusursuz-recete-2026-08-05]]
5. **🔴 Ülke kodu doğrulaması TELEFON KODUNU kabul ediyordu** (`countryCode="90"`)
   → cihaz sessizce ölü kalıyordu. 7 controller'da ortak şema.
6. **🔴 BAN DALGASI yanlış alarm** — eski hesapların banı "yeni dalga" sanılıyordu.
7. **🔴 Öksüz kayıt** — cihazda BAŞARILI ama panelde sonsuza kadar REGISTERING.
8. **🔴 Yeşil numara rozeti** — `markDeviceRegistered` metadata yazmıyordu.
9. **🟢 Profil çekme KAPATILDI** (`FLEET_WA_PROFILE`, varsayılan kapalı) — dakikada
   bir job açıp kayıt job'larıyla ADB'de yarışıyordu.
10. **🟢 Bildirim gürültüsü** — rutin işler yalnızca KÖTÜ sonuçta bildiriliyor.
11. **🟢 AL+9999 uyumsuzluğu** — 4 cihaz mobile hesapla AL istiyordu; residential+5555'e
    alındı. Filoda AL+9999 artık **0**. ⚠️İlk ölçümde mi5 AL döndü (TESADÜF), tekrar
    ölçümde 4'ü de başarısız → **tek ölçümden sonuç çıkarma**.
12. **🟢 Reboot kurtarma** — `fleet-boot-restore.service` (enabled, canlıda test edildi).
13. **🟢 Telegram çift bildirim + yenilemede kaybolan taslak** (`usePersistedState`).

## 🛟 YENİ: reboot kurtarma altyapısı
`/opt/fleet-recovery/` (repo: `deploy/kvm-host/recovery/`)
- `fleet-restore.sh {check|proxy|devices|all}` — **idempotent**, canlıda test edildi
- `fleet-boot-restore.service` — **enabled**, reboot'ta otomatik çalışır
- Yedekler: `iptables-nft-latest.rules` (141 kural) · `inst-country-latest.txt` (130 cihaz)

⚠️ **NEDEN ŞART:** cihazlar systemd ile YÖNETİLMİYOR (0 unit, hepsi elle `wd-run.sh`)
ve `iptables-persistent` KURULU DEĞİL → reboot'ta ne cihazlar ne 141 REDIRECT kuralı
geri gelir. REDIRECT kaybı = datacenter IP = **BAN**.

## ⚠️ ASIL DARBOĞAZ (çözülmedi — sizin kararınız)
**Numara kalitesi.** 5 Ağu'da **115 rate-limit**. Numaralar DB'de 1 kez denenmiş ama
WhatsApp "çok yakın zamanda denendi" diyor → **bize gelmeden önce başkası denemiş**.
UK (+44) denemesi de aynı nedenle battı: 3 numara, 0 ACTIVE, hepsi AWAITING_OTP'de kaldı;
proxy KUSURSUZDU (Three UK mobil IP, `verified exit=GB match=true`).
→ Sağlayıcıya spec gönderildi ([[docs/sms-provider-api-spec.md]]), yanıt bekleniyor.

## 🔄 7 AĞU EKİ — genel tarama yapıldı
Sistem **TEMİZ**: 133 cihaz ONLINE · 0 takılı job · 0 agent/API hatası · CPU %5.2 ·
D-Bus 28/1024 · proxy uyumsuzluğu 0. Dünkü tüm düzeltmeler yerinde.

İki anomali cihazda ELLE test edildi, **ikisi de zamanlamaymış** (arıza değil):
- `CHAT_NOT_OPENED` (bir cihazda %36) → `screenTexts`="Searching…", agent ekranı çok
  erken okuyor; gerçek sonuç INVALID_RECIPIENT. FIX: Searching'de tekrar oku.
- `NO_PROFILE` (43 vaka) → menü açılışı kör `sleep(600)`. FIX: dump doğrulaması + retry.
Detay: [[chat-not-opened-no-profile-zamanlama-2026-08-07]] · commit `74b840a`

## 📋 KALAN İŞLER
1. Tur limiti sınaması (yukarıda) · 2. Sağlık taramasını aç
3. **Yedek sunucu DIŞINA kopyalanmıyor** — disk ölürse yedek de ölür (3 gündür açık)
4. UK numaraları — sağlayıcı yanıtı bekleniyor
5. mi94 (`+905019418470`) hesabı BANNED, cihaz sağlıklı — yeni numarayla kullanılabilir

## ⚠️⚠️ BUGÜNÜN EN ÖNEMLİ DERSİ
**Çalışan bir akışı "iyileştirirken" 3 kez REGRESYON ürettim** (koşul ekleme →
fallback zincirini kesti · vtouch'a çevirme → modal iptal oluyordu · FIFO çiftleme).
Operatör "dün çalışıyordu" dedi, **haklıydı**. Hepsi geri alındı; downgrade bloğu
`5bfceb2` ile BİREBİR aynı (diff ile doğrulandı), tek fark tur limiti.
→ **Değiştirmeden önce neyin çalıştığını SABİTLE.** Koşul eklemek tüm fallback
zincirini sessizce kesebiliyor.

★İkinci ders: **dump'ın görmediği şey ekranda OLABİLİR** — ss ile doğrula.
Bu turda 3 hipotezim ölçümle çürüdü.

## GIT / SUNUCU
Dal `feat/cloud-phone-suite`, çalışma ağacı temiz. Bugünün son commit'i `1357bb2`.
`ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45` · kod `/opt/fleet` · agent `/opt/agent.mjs`
⚠️ **dist'e bak** — kaynakta grep bulması deploy edildiği anlamına gelmez.
⚠️ Deploy öncesi **aktif kayıt YOK mu** kontrol et (restart kaydı düşürür — bugün oldu).

İlgili: [[RESUME-kaldigimiz-yer-2026-08-05]] · [[dbus-baglanti-limiti-kurulum-donuyor-2026-08-05]] ·
[[wa-business-downgrade-kusursuz-recete-2026-08-05]] · [[vtouch-fifo-sessiz-noop-downgrade-2026-08-05]]
